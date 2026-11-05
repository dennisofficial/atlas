import type { HostTimers } from './ports'

const START_RETRY_BASE_MS = 1_000
const START_RETRY_CAP_MS = 30_000

export class StartBackoff {
  private readonly failures = new Map<string, number>()
  private readonly pending = new Map<string, unknown>()

  constructor(private readonly args: { timers: HostTimers; onDue(sessionId: string): void }) {}

  waiting(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  failed(sessionId: string): void {
    if (this.pending.has(sessionId)) return
    const count = this.failures.get(sessionId) ?? 0
    this.failures.set(sessionId, count + 1)
    const delay = Math.min(START_RETRY_BASE_MS * 2 ** count, START_RETRY_CAP_MS)
    const timer = this.args.timers.setTimeout(() => {
      this.pending.delete(sessionId)
      this.args.onDue(sessionId)
    }, delay)
    this.pending.set(sessionId, timer)
  }

  started(sessionId: string): void {
    this.failures.delete(sessionId)
  }

  cancelAll(): void {
    for (const timer of this.pending.values()) this.args.timers.clearTimeout(timer)
    this.pending.clear()
  }
}
