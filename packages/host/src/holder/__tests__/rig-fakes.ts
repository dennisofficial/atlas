import type { LiveFrame } from '@dltech/atlas-protocol'

import type { HostBus, HostTimers } from '../ports'

export const SANDBOX = 'holder-test-sandbox'
export const SECRET = 'holder-test-secret'
export const SESSION = 'session-rig'
export const THREAD = 'thread-rig'

export class FakeClock implements HostTimers {
  current = 0
  private seq = 0
  private readonly timers = new Map<number, { at: number; handler: () => void }>()

  now(): number {
    return this.current
  }

  setTimeout(handler: () => void, ms: number): unknown {
    this.seq += 1
    this.timers.set(this.seq, { at: this.current + ms, handler })
    return this.seq
  }

  clearTimeout(timer: unknown): void {
    this.timers.delete(timer as number)
  }

  random(): number {
    return 0.5
  }

  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (next === undefined) break
      this.timers.delete(next[0])
      this.current = next[1].at
      next[1].handler()
    }
    this.current = target
  }

  pendingCount(): number {
    return this.timers.size
  }

  pendingWithin(ms: number): boolean {
    return [...this.timers.values()].some((timer) => timer.at <= this.current + ms)
  }
}

export class FakeBus implements HostBus {
  readonly wakes: string[] = []
  readonly frames: { sessionId: string; frame: LiveFrame }[] = []
  private readonly listeners = new Set<(sessionId: string) => void>()
  private readonly resyncListeners = new Set<() => void>()

  onWake(listener: (sessionId: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onResync(listener: () => void): () => void {
    this.resyncListeners.add(listener)
    return () => {
      this.resyncListeners.delete(listener)
    }
  }

  resync(): void {
    for (const listener of [...this.resyncListeners]) listener()
  }

  async wake(sessionId: string): Promise<void> {
    this.wakes.push(sessionId)
    for (const listener of [...this.listeners]) listener(sessionId)
  }

  live(args: { sessionId: string; frame: LiveFrame }): void {
    this.frames.push({ ...args })
  }

  statuses(sessionId: string): readonly string[] {
    return this.frames
      .filter((entry) => entry.sessionId === sessionId && entry.frame.type === 'status')
      .map((entry) => (entry.frame as { state: string }).state)
  }
}

export const flushUntil = async (args: {
  check: () => Promise<boolean> | boolean
  attempts?: number
  advanceMs?: number
  clock?: FakeClock
}): Promise<boolean> => {
  for (let i = 0; i < (args.attempts ?? 50); i += 1) {
    if (await args.check()) return true
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (args.clock !== undefined) {
      const step = args.advanceMs ?? 2_000
      if (args.clock.pendingWithin(step)) args.clock.advance(step)
    }
  }
  return args.check()
}
