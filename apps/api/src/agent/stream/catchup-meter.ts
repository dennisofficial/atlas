import type { ProductAnalytics } from '@dltech/atlas-observability'
import type { EStreamSurface } from '@dltech/atlas-protocol'

export enum ECatchupStart {
  Cold = 'cold',
  Warm = 'warm',
  Reset = 'reset',
}

export type CatchupMeterArgs = {
  sessionId: string
  userId: string
  surface: EStreamSurface
  mainThread: boolean
  start: ECatchupStart
  startedAt: number
  beganBytes: number
  now: () => number
  sentBytes: () => number
  analytics: ProductAnalytics | undefined
}

export class CatchupMeter {
  private start: ECatchupStart
  private pages = 0
  private events = 0
  private behindEvents: number | undefined
  private drainWaits = 0
  private emitted = false

  constructor(private readonly args: CatchupMeterArgs) {
    this.start = args.start
  }

  markReset(): void {
    this.start = ECatchupStart.Reset
  }

  noteBehind(args: { headSeq: number; cursor: number }): void {
    if (this.behindEvents !== undefined) return
    this.behindEvents = Math.max(0, args.headSeq - args.cursor)
  }

  notePage(events: number): void {
    this.pages += 1
    this.events += events
  }

  noteDrainWait(): void {
    this.drainWaits += 1
  }

  reachedLive(): void {
    this.emit(true)
  }

  close(): void {
    this.emit(false)
  }

  private emit(reachedLive: boolean): void {
    if (this.emitted) return
    this.emitted = true
    this.args.analytics?.capture({
      userId: this.args.userId,
      event: 'session_catchup',
      properties: {
        session_id: this.args.sessionId,
        duration_ms: Math.max(0, Math.round(this.args.now() - this.args.startedAt)),
        bytes: Math.max(0, this.args.sentBytes() - this.args.beganBytes),
        events: this.events,
        pages: this.pages,
        start: this.start,
        surface: this.args.surface,
        main_thread: this.args.mainThread,
        reached_live: reachedLive,
        behind_events: this.behindEvents ?? 0,
        drain_waits: this.drainWaits,
      },
    })
  }
}
