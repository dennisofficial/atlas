import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'
import { WORKLOAD_CGROUP_ENV, killWorkloadBox, workloadCommand } from '@dltech/atlas-sandbox'

const KILL_GRACE_MS = 2000
const PIPE_DRAIN_MS = 1000

export type ManagedExit = {
  exitCode: number | null
  signal: string | null
  oom: boolean
}

type OutputHandler = (bytes: Uint8Array) => void

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const signalGroup = (args: { pid: number; signal: NodeJS.Signals }): void => {
  try {
    process.kill(-args.pid, args.signal)
  } catch {
    return
  }
}

export const boxOomKilled = (args: {
  pid: number
  env: Record<string, string | undefined>
}): boolean => {
  const workGroup = args.env[WORKLOAD_CGROUP_ENV]
  if (workGroup === undefined || workGroup === '') return false
  try {
    const events = readFileSync(join(workGroup, `w-${args.pid}`, 'memory.events'), 'utf8')
    const match = /^oom_kill\s+(\d+)$/m.exec(events)
    return match?.[1] !== undefined && Number(match[1]) > 0
  } catch {
    return false
  }
}

const pump = async (args: {
  stream: ReadableStream<Uint8Array>
  onOutput: OutputHandler
  readers: Set<() => void>
}): Promise<void> => {
  const reader = args.stream.getReader()
  const cancel = (): void => void reader.cancel()
  args.readers.add(cancel)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value.length > 0) args.onOutput(value)
    }
  } catch {
    return
  } finally {
    args.readers.delete(cancel)
  }
}

export class ManagedProcess {
  private readonly readers = new Set<() => void>()
  private readonly pumps: Promise<void>
  private killing = false

  private readonly child: Bun.Subprocess<'ignore' | 'pipe', 'pipe', 'pipe'>
  private readonly env: Record<string, string | undefined>
  private readonly input: Bun.FileSink | null

  private constructor(args: {
    child: Bun.Subprocess<'ignore' | 'pipe', 'pipe', 'pipe'>
    input: Bun.FileSink | null
    env: Record<string, string | undefined>
    onStdout: OutputHandler
    onStderr: OutputHandler
  }) {
    this.child = args.child
    this.input = args.input
    this.env = args.env
    this.pumps = Promise.all([
      pump({ stream: args.child.stdout, onOutput: args.onStdout, readers: this.readers }),
      pump({ stream: args.child.stderr, onOutput: args.onStderr, readers: this.readers }),
    ]).then(() => undefined)
  }

  static spawn(args: {
    cmd: readonly string[]
    cwd?: string | undefined
    env: Record<string, string | undefined>
    onStdout: OutputHandler
    onStderr: OutputHandler
    input?: boolean | undefined
  }): ManagedProcess {
    try {
      const options = {
        cmd: workloadCommand({ cmd: args.cmd, cwd: args.cwd, env: args.env }),
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
        env: args.env,
        stdout: 'pipe',
        stderr: 'pipe',
        detached: true,
      } as const
      const piped = args.input === true ? Bun.spawn({ ...options, stdin: 'pipe' }) : null
      const child = piped ?? Bun.spawn({ ...options, stdin: 'ignore' })
      return new ManagedProcess({
        child,
        input: piped?.stdin ?? null,
        env: args.env,
        onStdout: args.onStdout,
        onStderr: args.onStderr,
      })
    } catch (error) {
      throw new CallFailureError({ code: ECallFailure.SpawnFailed, message: messageOf(error) })
    }
  }

  get pid(): number {
    return this.child.pid
  }

  acceptsInput(): boolean {
    return this.input !== null
  }

  writeInput(bytes: Uint8Array): boolean {
    if (this.input === null) return false
    try {
      this.input.write(bytes)
      void this.input.flush()
      return true
    } catch {
      return false
    }
  }

  closeInput(): void {
    if (this.input === null) return
    try {
      void this.input.end()
    } catch {
      return
    }
  }

  kill(): void {
    if (this.killing) return
    this.killing = true
    signalGroup({ pid: this.child.pid, signal: 'SIGTERM' })
    setTimeout(() => this.killGroupNow(), KILL_GRACE_MS).unref()
  }

  async exit(): Promise<ManagedExit> {
    await this.child.exited
    this.killGroupNow()
    const drained = await Promise.race([
      this.pumps.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PIPE_DRAIN_MS)),
    ])
    if (!drained) for (const cancel of this.readers) cancel()
    return {
      exitCode: this.child.exitCode,
      signal: this.child.signalCode === null ? null : String(this.child.signalCode),
      oom: boxOomKilled({ pid: this.child.pid, env: this.env }),
    }
  }

  private killGroupNow(): void {
    signalGroup({ pid: this.child.pid, signal: 'SIGKILL' })
    killWorkloadBox({ pid: this.child.pid, env: this.env })
  }
}
