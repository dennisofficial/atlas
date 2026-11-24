import {
  EStreamClose,
  EStreamErrorCode,
  STREAM_PAGE_EVENTS,
  type SessionChange,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'
import { logFieldsOf } from '@dltech/atlas-observability'

import {
  FOLLOW_HIGH_WATER_BYTES,
  FOLLOW_PAGE_BYTES,
  FOLLOW_SLOW_CONSUMER_MS,
} from './follow-limits'
import { CatchupMeter, ECatchupStart } from './catchup-meter'
import type { FollowConnection, FollowDeps, FollowTarget, SubscriptionIndex } from './follow-types'
import { resolveStart, type StartRequest } from './resolve-start'

export type FollowSubscriptionArgs = {
  id: string
  sessionId: string
  threadId: string | undefined
  request: StartRequest
  connection: FollowConnection
  deps: FollowDeps
  index: SubscriptionIndex
  onEnded(subscription: FollowSubscription): void
}

export class FollowSubscription implements FollowTarget {
  readonly id: string
  readonly sessionId: string
  private thread: string | undefined
  private main = false
  private cursor: number | undefined
  private dirty = false
  private pumping = false
  private stopped = false
  private announcedLive = false
  private wakeDrain: (() => void) | undefined
  private meter: CatchupMeter | undefined
  private behindNoted = false

  constructor(private readonly args: FollowSubscriptionArgs) {
    this.id = args.id
    this.sessionId = args.sessionId
  }

  async begin(): Promise<void> {
    const startedAt = this.args.deps.timers.now()
    const beganBytes = this.args.connection.sentBytes()
    try {
      const session = await this.args.deps.plane.readSession({ sessionId: this.sessionId })
      if (this.stopped) return
      if (session === undefined || session.userId !== this.args.connection.userId) {
        this.args.connection.send({
          type: 'error',
          id: this.id,
          code: EStreamErrorCode.NotFound,
        })
        this.stop()
        return
      }
      const requested = this.args.threadId ?? session.mainThreadId
      if (requested !== session.mainThreadId) {
        const thread = await this.args.deps.plane.readThread({ threadId: requested })
        if (this.stopped) return
        if (thread === undefined || thread.sessionId !== this.sessionId) {
          this.args.connection.send({
            type: 'error',
            id: this.id,
            code: EStreamErrorCode.NotFound,
          })
          this.stop()
          return
        }
      }
      this.thread = requested
      this.main = requested === session.mainThreadId
      this.meter = new CatchupMeter({
        sessionId: this.sessionId,
        userId: this.args.connection.userId,
        surface: this.args.connection.surface,
        mainThread: this.main,
        start: this.args.request.afterSeq === undefined ? ECatchupStart.Cold : ECatchupStart.Warm,
        startedAt,
        beganBytes,
        now: () => this.args.deps.timers.now(),
        sentBytes: () => this.args.connection.sentBytes(),
        analytics: this.args.deps.analytics,
      })
      this.args.deps.recordSurface?.({
        sessionId: this.sessionId,
        userId: this.args.connection.userId,
        surface: this.args.connection.surface,
      })
      this.args.index.add(this)
      this.markDirty()
    } catch (error) {
      this.fail(error)
    }
  }

  get threadId(): string | undefined {
    return this.thread
  }

  get isMainThread(): boolean {
    return this.main
  }

  get liveKey(): string {
    return this.main ? this.sessionId : (this.thread ?? this.sessionId)
  }

  get protocolVersion(): number {
    return this.args.connection.version
  }

  send(message: StreamServerMessage): void {
    if (this.stopped) return
    this.args.connection.send(message)
  }

  bufferedAmount(): number {
    return this.args.connection.bufferedAmount()
  }

  handleChange(change: SessionChange): void {
    if (change.threadId !== this.threadId || change.headSeq === undefined) return
    if (this.cursor !== undefined && change.headSeq <= this.cursor) return
    this.markDirty()
  }

  handleDrain(): void {
    if (this.stopped) return
    this.releaseDrainWait()
    this.args.index.drained(this)
  }

  markDirty(): void {
    if (this.stopped) return
    this.dirty = true
    if (this.pumping || this.threadId === undefined) return
    void this.pump()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.meter?.close()
    this.args.index.remove(this)
    this.releaseDrainWait()
    this.args.onEnded(this)
  }

  private async pump(): Promise<void> {
    this.pumping = true
    try {
      while (!this.stopped && this.dirty) {
        if (this.cursor === undefined) {
          if (!(await this.awaitDrained())) return
          if (!(await this.start())) return
        }
        await this.drainPages()
      }
    } catch (error) {
      this.fail(error)
    } finally {
      this.pumping = false
    }
  }

  private async start(): Promise<boolean> {
    const position = await resolveStart({
      plane: this.args.deps.plane,
      threadId: this.requireThread(),
      request: this.args.request,
    })
    if (this.stopped) return false
    this.cursor = position.cursor
    if (position.reset !== undefined) {
      this.meter?.markReset()
      this.args.connection.send({ type: 'reset', id: this.id, ...position.reset })
    }
    return true
  }

  private async drainPages(): Promise<void> {
    const { plane } = this.args.deps
    const threadId = this.requireThread()
    let head = await plane.head({ threadId })
    if (this.stopped) return
    if (!this.behindNoted) {
      this.behindNoted = true
      this.meter?.noteBehind({ headSeq: head.seq, cursor: this.cursor ?? 0 })
    }
    for (;;) {
      if (!(await this.awaitDrained())) return
      this.dirty = false
      const page = await plane.readEvents({
        threadId,
        afterSeq: this.cursor ?? 0,
        limit: STREAM_PAGE_EVENTS,
        visible: false,
        maxBytes: FOLLOW_PAGE_BYTES,
      })
      if (this.stopped) return
      const last = page.events[page.events.length - 1]
      if (last === undefined && this.announcedLive) return
      if (last !== undefined) this.cursor = last.seq
      if (page.next === undefined && (this.cursor ?? 0) >= head.seq) {
        head = await plane.head({ threadId })
        if (this.stopped) return
      }
      const live = page.next === undefined && (this.cursor ?? 0) >= head.seq
      this.args.connection.send({
        type: 'events',
        id: this.id,
        events: page.events,
        head: { seq: head.seq, hash: head.hash },
        live,
      })
      this.meter?.notePage(page.events.length)
      if (this.isMainThread)
        this.args.deps.viewHead?.({ sessionId: this.sessionId, headSeq: head.seq })
      if (live) {
        this.announcedLive = true
        this.meter?.reachedLive()
        return
      }
    }
  }

  private async awaitDrained(): Promise<boolean> {
    const { connection, deps } = this.args
    if (connection.bufferedAmount() < FOLLOW_HIGH_WATER_BYTES) return !this.stopped
    this.meter?.noteDrainWait()
    const slowTimer = deps.timers.setTimeout(() => {
      connection.close(EStreamClose.SlowConsumer)
      this.stop()
    }, FOLLOW_SLOW_CONSUMER_MS)
    try {
      while (connection.bufferedAmount() >= FOLLOW_HIGH_WATER_BYTES) {
        if (this.stopped) return false
        await new Promise<void>((resolve) => {
          this.wakeDrain = resolve
        })
      }
    } finally {
      deps.timers.clearTimeout(slowTimer)
    }
    return !this.stopped
  }

  private releaseDrainWait(): void {
    const wake = this.wakeDrain
    this.wakeDrain = undefined
    wake?.()
  }

  private requireThread(): string {
    if (this.threadId === undefined) throw new Error('subscription has no thread')
    return this.threadId
  }

  private fail(error: unknown): void {
    this.args.deps.log?.error({
      source: 'stream',
      message: 'follow pump failed',
      ...logFieldsOf({ error }),
    })
    this.args.connection.send({ type: 'error', id: this.id, code: EStreamErrorCode.Internal })
    this.stop()
  }
}
