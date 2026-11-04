import {
  ProcessPort,
  type ProcessHandle,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, EExecOutcome, type ExecResult } from '@dltech/atlas-protocol'

import { markInterrupted, nextKey } from '../call-scope'
import type { RemoteCalls } from '../remote-calls'

export const DEFAULT_SANDBOX_COMMANDS: Readonly<Record<string, string>> = {
  bash: 'bash',
  rg: 'rg',
  git: 'git',
}

const exitCodeOf = (result: ExecResult): number => {
  if (result.exitCode !== null) return result.exitCode
  if (result.outcome === EExecOutcome.Cancelled) return 130
  if (result.outcome === EExecOutcome.TimedOut) return 124
  return 1
}

const definedEnv = (env: Record<string, string | undefined>): Record<string, string> => {
  const defined: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) defined[key] = value
  }
  return defined
}

export class DaemonProcessPort extends ProcessPort {
  constructor(
    private readonly args: {
      calls: RemoteCalls
      known?: Readonly<Record<string, string>> | undefined
    },
  ) {
    super()
  }

  spawn(args: SpawnCommand): ProcessHandle {
    const controller = new AbortController()
    const key = nextKey()
    let output: TransformStream<Uint8Array, Uint8Array> | null = new TransformStream<
      Uint8Array,
      Uint8Array
    >()
    const writer = output.writable.getWriter()
    const exited = this.args.calls
      .invoke({
        key,
        op: {
          op: 'exec',
          argv: [...args.cmd],
          cwd: args.cwd,
          ...(args.env === undefined ? {} : { env: definedEnv(args.env) }),
        },
        signal: controller.signal,
        onOutput: (bytes) => void writer.write(bytes),
      })
      .then((result) => {
        if (result.status === ECallStatus.Failed) {
          if (result.error.code === ECallFailure.Interrupted) markInterrupted()
          return 1
        }
        return exitCodeOf(result.value as ExecResult)
      })
      .catch(() => 1)
      .finally(() => {
        void writer.close().catch(() => undefined)
        output = null
      })
    exited.catch(() => undefined)
    return {
      get stdout() {
        return output === null ? new ReadableStream<Uint8Array>() : output.readable
      },
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited,
      terminate: () => controller.abort(),
    }
  }

  override which(_args: { command: string; threadId?: ThreadId | undefined }): string | null {
    const known = this.args.known ?? DEFAULT_SANDBOX_COMMANDS
    return known[_args.command] ?? null
  }

  override async vendored(_args: {
    command: string
    threadId?: ThreadId | undefined
  }): Promise<null> {
    return null
  }
}
