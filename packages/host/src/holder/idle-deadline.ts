import type { HostTimers } from './ports'

export class IdleDeadline {
  private timer: unknown
  private firedFor = -Infinity

  constructor(private readonly args: { timers: HostTimers; idleMinutes: number; onDue(): void }) {}

  arm(args: { lastActivityAt: number }): void {
    this.disarm()
    const deadline = args.lastActivityAt + this.args.idleMinutes * 60_000
    if (deadline <= this.firedFor) return
    const ms = Math.max(1, deadline - this.args.timers.now())
    this.timer = this.args.timers.setTimeout(() => {
      this.timer = undefined
      this.firedFor = deadline
      this.args.onDue()
    }, ms)
  }

  disarm(): void {
    if (this.timer === undefined) return
    this.args.timers.clearTimeout(this.timer)
    this.timer = undefined
  }
}
