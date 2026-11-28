const SUSPEND_GAP_MS = 30_000
const FREEZE_SKEW_MS = 2_000

export type TunnelClockArgs = {
  suspendGapMs?: number | undefined
  wallNow?: (() => number) | undefined
  monotonicNow?: (() => number) | undefined
}

export class TunnelClock {
  private readonly wallNow: () => number
  private readonly monotonicNow: () => number
  private lastWall: number
  private lastMonotonic: number

  constructor(private readonly args: TunnelClockArgs) {
    this.wallNow = args.wallNow ?? Date.now
    this.monotonicNow = args.monotonicNow ?? (() => performance.now())
    this.lastWall = this.wallNow()
    this.lastMonotonic = this.monotonicNow()
  }

  suspendGap(): number | undefined {
    const wall = this.wallNow()
    const monotonic = this.monotonicNow()
    const wallDelta = wall - this.lastWall
    const monotonicDelta = monotonic - this.lastMonotonic
    this.lastWall = wall
    this.lastMonotonic = monotonic
    if (wallDelta - monotonicDelta >= FREEZE_SKEW_MS) return wallDelta
    if (wallDelta >= (this.args.suspendGapMs ?? SUSPEND_GAP_MS)) return wallDelta
    return undefined
  }
}
