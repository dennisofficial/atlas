import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { WORKLOAD_CGROUP_ENV, killWorkloadBox, workloadCommand } from '@dltech/atlas-sandbox'

export type ManagedLog = {
  append(args: { bytes: Uint8Array }): Promise<void>
  readFrom(args: { offset: number }): Promise<Uint8Array>
  size(): Promise<number>
}

export type ManagedInput = {
  write(data: string | Uint8Array): number | Promise<number>
  end(): number | Promise<number>
}

export type SpawnedChild = {
  pid: number
  stdin: ManagedInput | null
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill(): void
}

export type SpawnImpl = (args: {
  cmd: readonly string[]
  cwd: string | undefined
  env: Record<string, string | undefined> | undefined
}) => SpawnedChild

export const boxedSpawnImpl: SpawnImpl = (args) => {
  const child = Bun.spawn(workloadCommand({ cmd: args.cmd, cwd: args.cwd, env: args.env }), {
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    ...(args.env === undefined ? {} : { env: args.env }),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited: child.exited,
    kill: () => {
      killWorkloadBox({ pid: child.pid })
      child.kill()
    },
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
    return match !== null && match[1] !== undefined && Number(match[1]) > 0
  } catch {
    return false
  }
}

export type ManagedExit = {
  exitCode: number | null
  oom: boolean
}

export class ManagedProcess {
  private readonly pumps: Promise<void>[] = []

  private constructor(
    private readonly spawned: SpawnedChild,
    private readonly env: Record<string, string | undefined>,
    readonly bytesWritten: { count: number },
  ) {}

  get exited(): Promise<number> {
    return this.spawned.exited
  }

  static spawn(args: {
    cmd: readonly string[]
    cwd?: string | undefined
    env?: Record<string, string | undefined> | undefined
    log: ManagedLog
    onChunk?: ((args: { bytes: Uint8Array; offset: number }) => void) | undefined
    spawn?: SpawnImpl | undefined
  }): ManagedProcess {
    const spawned = (args.spawn ?? boxedSpawnImpl)({
      cmd: args.cmd,
      cwd: args.cwd,
      env: args.env,
    })
    const bytesWritten = { count: 0 }
    const process = new ManagedProcess(spawned, args.env ?? {}, bytesWritten)
    process.pumps.push(
      process.pump({ stream: spawned.stdout, log: args.log, onChunk: args.onChunk }),
    )
    process.pumps.push(
      process.pump({ stream: spawned.stderr, log: args.log, onChunk: args.onChunk }),
    )
    return process
  }

  private async pump(args: {
    stream: ReadableStream<Uint8Array>
    log: ManagedLog
    onChunk: ((args: { bytes: Uint8Array; offset: number }) => void) | undefined
  }): Promise<void> {
    const reader = args.stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        if (value === undefined || value.length === 0) continue
        const offset = this.bytesWritten.count
        this.bytesWritten.count += value.length
        await args.log.append({ bytes: value })
        args.onChunk?.({ bytes: value, offset })
      }
    } catch {
      return
    } finally {
      reader.releaseLock()
    }
  }

  writeInput(args: { bytes: Uint8Array }): void {
    this.spawned.stdin?.write(args.bytes)
  }

  closeInput(): void {
    void this.spawned.stdin?.end()
  }

  kill(): void {
    this.spawned.kill()
  }

  oomKilled(): boolean {
    return boxOomKilled({ pid: this.spawned.pid, env: this.env })
  }

  async exit(): Promise<ManagedExit> {
    const exitCode = await this.spawned.exited
    await Promise.all(this.pumps)
    return { exitCode, oom: this.oomKilled() }
  }
}
