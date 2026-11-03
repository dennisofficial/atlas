import { appendFile, mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { EShellRunStatus, type ShellInfo } from '@dltech/atlas-protocol'

import type { DaemonOpsDeps } from '../deps'

export const OUTPUT_EVENT_THROTTLE_MS = 100

export type ShellEnd = {
  status: EShellRunStatus
  exitCode: number | null
  signal: string | null
}

type EndHandler = (end: ShellEnd) => void

export class ShellRecord {
  pid: number
  readonly shellId: string
  readonly command: string
  readonly startedAt = new Date().toISOString()
  totalBytes = 0
  storedBytes = 0
  limitBytes: number | null = null
  private end: ShellEnd | null = null
  private endAt = ''
  private readonly waiters = new Set<EndHandler>()

  constructor(args: { shellId: string; command: string; pid: number }) {
    this.shellId = args.shellId
    this.command = args.command
    this.pid = args.pid
  }

  get ended(): boolean {
    return this.end !== null
  }

  info(): ShellInfo {
    const ended = this.end
    return {
      shellId: this.shellId,
      command: this.command,
      pid: this.pid,
      startedAt: this.startedAt,
      status: ended === null ? EShellRunStatus.Running : ended.status,
      exitCode: ended === null ? null : ended.exitCode,
      signal: ended === null ? null : ended.signal,
      ...(ended === null ? {} : { endedAt: this.endAt }),
      totalBytes: this.totalBytes,
    }
  }

  onEnd(handler: EndHandler): void {
    if (this.end !== null) {
      handler(this.end)
      return
    }
    this.waiters.add(handler)
  }

  settle(end: ShellEnd): boolean {
    if (this.end !== null) return false
    this.end = end
    this.endAt = new Date().toISOString()
    for (const handler of this.waiters) handler(end)
    this.waiters.clear()
    return true
  }
}

export class ShellStore {
  private readonly shells = new Map<string, ShellRecord>()
  private readonly chains = new Map<string, Promise<void>>()
  private readonly timers = new Map<string, Timer>()
  private readonly throttles = new Map<string, { last: number; timer: Timer | null }>()

  constructor(private readonly deps: DaemonOpsDeps) {}

  get(shellId: string): ShellRecord | undefined {
    return this.shells.get(shellId)
  }

  list(): ShellRecord[] {
    return [...this.shells.values()]
  }

  add(shell: ShellRecord): void {
    this.shells.set(shell.shellId, shell)
  }

  outputPath(shellId: string): string {
    return join(this.deps.home, 'shells', shellId, 'output.bin')
  }

  async appendOutput(args: { shellId: string; bytes: Uint8Array }): Promise<void> {
    const previous = this.chains.get(args.shellId) ?? Promise.resolve()
    const next = previous.then(() => this.appendNow(args))
    this.chains.set(args.shellId, next)
    await next
  }

  private async appendNow(args: { shellId: string; bytes: Uint8Array }): Promise<void> {
    const shell = this.shells.get(args.shellId)
    if (shell === undefined) return
    const accepted = this.acceptedBytes({ shell, bytes: args.bytes })
    shell.totalBytes += args.bytes.length
    if (accepted.length === 0) return
    shell.storedBytes += accepted.length
    await appendFile(this.outputPath(args.shellId), accepted)
  }

  private acceptedBytes(args: { shell: ShellRecord; bytes: Uint8Array }): Uint8Array {
    const limit = args.shell.limitBytes
    if (limit === null) return args.bytes
    const room = limit - args.shell.storedBytes
    if (room <= 0) return new Uint8Array(0)
    return args.bytes.subarray(0, Math.min(room, args.bytes.length))
  }

  async readOutput(args: {
    shellId: string
    offset: number
    limit: number
  }): Promise<{ offset: number; bytes: Uint8Array; totalBytes: number }> {
    const chain = this.chains.get(args.shellId) ?? Promise.resolve()
    await chain
    const shell = this.shells.get(args.shellId)
    const counted = shell?.totalBytes ?? 0
    const path = this.outputPath(args.shellId)
    const size = await stat(path)
      .then((info) => info.size)
      .catch(() => 0)
    if (args.offset >= size) {
      return { offset: args.offset, bytes: new Uint8Array(0), totalBytes: counted }
    }
    const handle = await open(path, 'r')
    try {
      const length = Math.min(args.limit, size - args.offset)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, args.offset)
      return { offset: args.offset, bytes: new Uint8Array(buffer), totalBytes: counted }
    } finally {
      await handle.close()
    }
  }

  throttle(args: { shellId: string; notify: () => void }): void {
    const entry = this.throttles.get(args.shellId) ?? { last: 0, timer: null }
    this.throttles.set(args.shellId, entry)
    const elapsed = Date.now() - entry.last
    if (elapsed >= OUTPUT_EVENT_THROTTLE_MS && entry.timer === null) {
      entry.last = Date.now()
      args.notify()
      return
    }
    if (entry.timer !== null) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      entry.last = Date.now()
      args.notify()
    }, OUTPUT_EVENT_THROTTLE_MS - elapsed)
    entry.timer.unref()
  }

  setTimeoutFor(args: { shellId: string; ms: number; fire: () => void }): void {
    const timer = setTimeout(args.fire, args.ms)
    timer.unref()
    this.timers.set(args.shellId, timer)
  }

  clearTimeoutFor(shellId: string): void {
    const timer = this.timers.get(shellId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.timers.delete(shellId)
  }

  endTimers(shellId: string): void {
    this.clearTimeoutFor(shellId)
    const entry = this.throttles.get(shellId)
    if (entry?.timer != null) clearTimeout(entry.timer)
    this.throttles.delete(shellId)
  }

  clearAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const entry of this.throttles.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer)
    }
    this.throttles.clear()
  }

  async makeDir(shellId: string): Promise<void> {
    await mkdir(join(this.deps.home, 'shells', shellId), { recursive: true })
  }
}
