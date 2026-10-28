import type { Schedule } from '../delivery-buffer'

type Timer = { at: number; run: () => void; live: boolean }

export class FakeClock {
  private current = 0
  private readonly timers: Timer[] = []

  readonly now = (): number => this.current

  readonly schedule: Schedule = ({ ms, run }) => {
    const timer: Timer = { at: this.current + ms, run, live: true }
    this.timers.push(timer)
    return () => {
      timer.live = false
    }
  }

  pending(): number {
    return this.timers.filter((timer) => timer.live).length
  }

  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.live && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0]
      if (due === undefined) break
      due.live = false
      this.current = due.at
      due.run()
    }
    this.current = target
  }
}
