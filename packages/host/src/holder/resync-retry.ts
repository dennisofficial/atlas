import type { HostTimers } from './ports'

const BASE_MS = 250
const CAP_MS = 5_000

export class ResyncRetry {
  private readonly timers: HostTimers
  private readonly retry: () => void
  private readonly draining: () => boolean
  private timer: unknown
  private failures = 0

  constructor(args: { timers: HostTimers; retry: () => void; draining: () => boolean }) {
    this.timers = args.timers
    this.retry = args.retry
    this.draining = args.draining
  }

  schedule(): void {
    if (this.draining() || this.timer !== undefined) return
    const delay = Math.min(BASE_MS * 2 ** this.failures, CAP_MS)
    this.failures += 1
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined
      this.retry()
    }, delay)
  }

  succeeded(): void {
    this.failures = 0
  }

  cancel(): void {
    if (this.timer === undefined) return
    this.timers.clearTimeout(this.timer)
    this.timer = undefined
  }
}
