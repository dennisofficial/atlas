// A suspended laptop freezes timers with everything else, so the first tick after wake lands one
// sleep-duration late — the wall-clock gap between ticks is how Claude Code detects a wake (no OS
// wake event is portable). The defaults follow theirs: tick every 10s, call it a sleep past 60s.

export const DEFAULT_TICK_MS = 10_000
export const DEFAULT_JUMP_THRESHOLD_MS = 60_000

export type ClockJump = { gapMs: number }
export type OnClockJump = (jump: ClockJump) => void

export type IntervalHandle = unknown
export type IntervalScheduler = {
  schedule: (callback: () => void) => IntervalHandle
  cancel: (handle: IntervalHandle) => void
}

const systemScheduler = (tickMs: number): IntervalScheduler => ({
  schedule: (callback) => {
    const timer = setInterval(callback, tickMs)
    timer.unref()
    return timer
  },
  cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
})

export class ClockJumpDetector {
  private readonly now: () => number
  private readonly intervals: IntervalScheduler
  private readonly thresholdMs: number
  private readonly subscribers = new Set<OnClockJump>()
  private handle: IntervalHandle | null = null
  private lastTickMs = 0

  constructor(args: {
    now?: (() => number) | undefined
    intervals?: IntervalScheduler | undefined
    tickMs?: number | undefined
    thresholdMs?: number | undefined
  }) {
    this.now = args.now ?? Date.now
    this.intervals = args.intervals ?? systemScheduler(args.tickMs ?? DEFAULT_TICK_MS)
    this.thresholdMs = args.thresholdMs ?? DEFAULT_JUMP_THRESHOLD_MS
  }

  subscribe(subscriber: OnClockJump): () => void {
    this.subscribers.add(subscriber)
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  start(): void {
    if (this.handle !== null) return
    this.lastTickMs = this.now()
    this.handle = this.intervals.schedule(() => this.handleTick())
  }

  stop(): void {
    if (this.handle === null) return
    this.intervals.cancel(this.handle)
    this.handle = null
  }

  private handleTick(): void {
    const tickedAt = this.now()
    const gapMs = tickedAt - this.lastTickMs
    this.lastTickMs = tickedAt
    if (gapMs <= this.thresholdMs) return
    for (const subscriber of this.subscribers) subscriber({ gapMs })
  }
}
