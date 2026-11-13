import type { HostTimers } from './ports'

export class ProgressWatchdog {
  private timer: unknown
  private armed = false

  constructor(
    private readonly args: {
      timers: HostTimers
      stallAfterMs: number
      onStall(stalledForMs: number): void
    },
  ) {}

  arm(): void {
    this.clear()
    this.armed = true
    this.schedule()
  }

  touch(): void {
    if (!this.armed) return
    this.clear()
    this.schedule()
  }

  disarm(): void {
    this.armed = false
    this.clear()
  }

  private schedule(): void {
    this.timer = this.args.timers.setTimeout(() => {
      this.timer = undefined
      this.armed = false
      this.args.onStall(this.args.stallAfterMs)
    }, this.args.stallAfterMs)
  }

  private clear(): void {
    if (this.timer === undefined) return
    this.args.timers.clearTimeout(this.timer)
    this.timer = undefined
  }
}
