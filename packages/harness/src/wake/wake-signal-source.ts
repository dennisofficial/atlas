import type { ClockJump } from './clock-jump-detector'
import type { WakeSignal } from './wake-signals'

export class WakeSignalSource implements WakeSignal {
  private readonly now: () => number
  private readonly listeners = new Set<(jump: ClockJump) => void>()
  private lastJumpAtMs: number | null = null

  constructor(args: { now?: (() => number) | undefined } = {}) {
    this.now = args.now ?? Date.now
  }

  subscribe(listener: (jump: ClockJump) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  wasWakeRecent(withinMs: number): boolean {
    if (this.lastJumpAtMs === null) return false
    return this.now() - this.lastJumpAtMs <= withinMs
  }

  fire(jump: ClockJump): void {
    this.lastJumpAtMs = this.now()
    for (const listener of this.listeners) listener(jump)
  }
}
