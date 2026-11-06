import {
  CallInterruptedError,
  EProcessOutcome,
  ProcessPort,
  type ProcessHandle,
  type ProcessOutcome,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  callFailureOf,
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type ExecResult,
} from '@dltech/atlas-protocol'

import { nextKey } from '../call-scope'
import type { RemoteCalls } from '../remote-calls'

export const DEFAULT_SANDBOX_COMMANDS: Readonly<Record<string, string>> = {
  bash: 'bash',
  rg: 'rg',
  git: 'git',
}

const OOM_KILLED_EXIT_CODE = 137

const exitedOutcomeOf = (result: ExecResult): ProcessOutcome => {
  if (result.outcome === EExecOutcome.OomKilled) return { kind: EProcessOutcome.OomKilled }
  if (result.exitCode !== null) return { kind: EProcessOutcome.Exited, code: result.exitCode }
  if (result.outcome === EExecOutcome.Cancelled) return { kind: EProcessOutcome.Exited, code: 130 }
  if (result.outcome === EExecOutcome.TimedOut) return { kind: EProcessOutcome.Exited, code: 124 }
  return {
    kind: EProcessOutcome.Failed,
    code: ECallFailure.Internal,
    message: `the command ended without an exit code (${result.outcome})`,
  }
}

const failedOutcomeOf = (failure: { code: string; message: string }): ProcessOutcome =>
  failure.code === ECallFailure.Interrupted
    ? { kind: EProcessOutcome.Interrupted }
    : { kind: EProcessOutcome.Failed, code: failure.code, message: failure.message }

const exitCodeOf = (outcome: ProcessOutcome): number => {
  if (outcome.kind === EProcessOutcome.Exited) return outcome.code
  if (outcome.kind === EProcessOutcome.OomKilled) return OOM_KILLED_EXIT_CODE
  if (outcome.kind === EProcessOutcome.Interrupted) {
    throw new CallInterruptedError('the command was interrupted before it finished')
  }
  throw new Error(outcome.message)
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
      calls: Pick<RemoteCalls, 'invoke'>
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
    const outcome: Promise<ProcessOutcome> = this.args.calls
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
      .then((result) =>
        result.status === ECallStatus.Failed
          ? failedOutcomeOf(result.error)
          : exitedOutcomeOf(result.value as ExecResult),
      )
      .catch((error: unknown) => failedOutcomeOf(callFailureOf(error)))
      .finally(() => {
        void writer.close().catch(() => undefined)
        output = null
      })
    const exited = outcome.then(exitCodeOf)
    exited.catch(() => undefined)
    return {
      get stdout() {
        return output === null ? new ReadableStream<Uint8Array>() : output.readable
      },
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited,
      outcome,
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
