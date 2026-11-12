import type { HostTimers } from './ports'

export class ProgressWatchdog {
  private timer: unknown
  private armed = false
  private holds = 0

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

  hold(): void {
    this.holds += 1
    this.clear()
  }

  release(): void {
    if (this.holds === 0) return
    this.holds -= 1
    if (this.holds === 0 && this.armed) this.schedule()
  }

  private schedule(): void {
    if (this.holds > 0) return
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
