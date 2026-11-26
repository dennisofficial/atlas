import type { ProductAnalytics } from '@dltech/atlas-observability'
import type { EStreamSurface } from '@dltech/atlas-protocol'

export enum ECatchupStart {
  Cold = 'cold',
  Warm = 'warm',
  Reset = 'reset',
  Tail = 'tail',
}

export type CatchupMeterArgs = {
  sessionId: string
  userId: string
  client: EStreamSurface
  mainThread: boolean
  start: ECatchupStart
  startedAt: number
  now: () => number
  analytics: ProductAnalytics | undefined
}

export class CatchupMeter {
  private start: ECatchupStart
  private pages = 0
  private events = 0
  private bytes = 0
  private behindEvents: number | undefined
  private drainWaits = 0
  private tailMissed = false
  private emitted = false

  constructor(private readonly args: CatchupMeterArgs) {
    this.start = args.start
  }

  markReset(): void {
    this.start = ECatchupStart.Reset
  }

  markTail(): void {
    this.start = ECatchupStart.Tail
  }

  markTailMissed(): void {
    this.tailMissed = true
  }

  noteBehind(args: { headSeq: number; cursor: number }): void {
    if (this.behindEvents !== undefined) return
    this.behindEvents = Math.max(0, args.headSeq - args.cursor)
  }

  notePage(events: number): void {
    this.pages += 1
    this.events += events
  }

  noteBytes(bytes: number): void {
    this.bytes += Math.max(0, bytes)
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
        bytes: this.bytes,
        events: this.events,
        pages: this.pages,
        start: this.start,
        client: this.args.client,
        main_thread: this.args.mainThread,
        reached_live: reachedLive,
        behind_events: this.behindEvents ?? 0,
        drain_waits: this.drainWaits,
        tail_missed: this.tailMissed,
      },
    })
  }
}
