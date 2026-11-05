import type { HostTimers } from './ports'

export class HolderSweep {
  private readonly timers: HostTimers
  private readonly intervalMs: number
  private readonly tick: () => Promise<void>
  private timer: unknown
  private stopped = true

  constructor(args: { timers: HostTimers; intervalMs: number; tick: () => Promise<void> }) {
    this.timers = args.timers
    this.intervalMs = args.intervalMs
    this.tick = args.tick
  }

  start(): void {
    if (!this.stopped || this.intervalMs <= 0) return
    this.stopped = false
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    if (this.timer === undefined) return
    this.timers.clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(): void {
    if (this.stopped) return
    const delay = Math.round(this.intervalMs * (0.8 + 0.4 * this.timers.random()))
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined
      void this.run()
    }, delay)
  }

  private async run(): Promise<void> {
    try {
      await this.tick()
    } catch {
      return this.schedule()
    }
    this.schedule()
  }
}
