import type { HostTimers } from '@dltech/atlas-host'

type Pending = { at: number; handler: () => void }

export class FakeTimers implements HostTimers {
  randomValue = 0.5
  private clock = 0
  private nextId = 0
  private readonly pending = new Map<number, Pending>()

  now(): number {
    return this.clock
  }

  setTimeout(handler: () => void, ms: number): unknown {
    this.nextId += 1
    this.pending.set(this.nextId, { at: this.clock + ms, handler })
    return this.nextId
  }

  clearTimeout(timer: unknown): void {
    if (typeof timer === 'number') this.pending.delete(timer)
  }

  random(): number {
    return this.randomValue
  }

  pendingCount(): number {
    return this.pending.size
  }

  advance(ms: number): void {
    const target = this.clock + ms
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (due === undefined) break
      this.pending.delete(due[0])
      this.clock = Math.max(this.clock, due[1].at)
      due[1].handler()
    }
    this.clock = target
  }
}
