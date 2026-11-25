import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  chainHash,
  GENESIS_HASH,
  type LogHead,
  toRunId,
  toThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import {
  EStreamSubscribeKind,
  EStreamSurface,
  STREAM_PROTOCOL_VERSION,
} from '@dltech/atlas-protocol'

import { ProductAnalytics, type ProductAnalyticsProperties } from '@dltech/atlas-observability'

import { createFollowSubscriptions, type FollowSubscriptions } from '../follow-port'
import type { FollowPlane, SurfaceRecord } from '../follow-types'
import type { LiveSource } from '../live-source'
import type {
  OutgoingFrame,
  StreamSubscriptionMessage,
  SubscriptionSession,
} from '../subscription-port'
import { FakeTimers } from './fake-timers'
import { until } from './until'

export const SESSION = 'session-1'
export const THREAD = 'thread-1'
export const OWNER = 'user-a'
const AT = '2026-11-02T12:00:00.000Z'

export const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

export type Capture = { userId: string; event: string; properties: ProductAnalyticsProperties }

export class RecordingAnalytics extends ProductAnalytics {
  readonly captures: Capture[] = []

  capture(args: Capture): void {
    this.captures.push(args)
  }

  async flush(): Promise<void> {}

  eventsOf(name: string): Capture[] {
    return this.captures.filter((capture) => capture.event === name)
  }
}

export class FollowRig {
  readonly store = new InMemoryControlStore()
  readonly plane = new ControlPlane({ store: this.store, clock: () => AT })
  readonly timers = new FakeTimers()
  readonly sent: OutgoingFrame[] = []
  readonly closedWith: number[] = []
  readonly surfaces: SurfaceRecord[] = []
  readonly analytics = new RecordingAnalytics()
  buffered = 0
  reads = 0
  headReads = 0
  tailBaseReads = 0
  onRead: (() => Promise<void>) | undefined
  readonly follow: FollowSubscriptions
  private epoch = 0
  private head: LogHead = { seq: 0, hash: GENESIS_HASH }

  statusReads = 0
  readonly scriptedViewAt: number[] = []
  digestReads = 0
  digestFailure: Error | undefined
  private readonly gapListeners = new Set<() => void>()

  constructor(args: { live?: LiveSource } = {}) {
    const plane: FollowPlane = {
      readSession: (params) => this.plane.readSession(params),
      readThread: (params) => this.plane.readThread(params),
      head: (params) => {
        this.headReads += 1
        return this.plane.head(params)
      },
      readEvents: async (params) => {
        this.reads += 1
        const page = await this.plane.readEvents(params)
        await this.onRead?.()
        return page
      },
      readSessionView: async (params) => {
        this.statusReads += 1
        const read = await this.plane.readSessionView(params)
        const at = this.scriptedViewAt.shift()
        return at === undefined ? read : { ...read, at }
      },
      readTailBase: async (params) => {
        this.tailBaseReads += 1
        return this.plane.readTailBase(params)
      },
      listSessionDigests: (params) => {
        this.digestReads += 1
        if (this.digestFailure !== undefined) return Promise.reject(this.digestFailure)
        return this.plane.listSessionDigests(params)
      },
    }
    this.follow = createFollowSubscriptions({
      plane,
      timers: this.timers,
      log: undefined,
      analytics: this.analytics,
      recordSurface: (record) => this.surfaces.push(record),
      feed: {
        onChange: (listener) => this.store.onChange(listener),
        onGap: (listener) => {
          this.gapListeners.add(listener)
          return () => this.gapListeners.delete(listener)
        },
      },
      live: args.live,
    })
  }

  async seed(args: { events: number; sessionId?: string; userId?: string }): Promise<void> {
    const sessionId = args.sessionId ?? SESSION
    await this.plane.createSession({
      sessionId,
      userId: args.userId ?? OWNER,
      projectId: 'project-1',
      mainThreadId: sessionId === SESSION ? THREAD : `${sessionId}-thread`,
    })
    const lease = await this.plane.grant({ sessionId, hostId: 1 })
    this.epoch = lease.epoch
    if (sessionId !== SESSION) return
    if (args.events > 0)
      await this.append(Array.from({ length: args.events }, (_, n) => said(`m${n}`)))
  }

  async append(bodies: readonly RecordEventBody[]): Promise<RecordEvent[]> {
    const events = chainEvents({
      threadId: toThreadId(THREAD),
      runId: toRunId('run-1'),
      epoch: this.epoch,
      at: AT,
      bodies,
      from: this.head,
    })
    const outcome = await this.plane.append({ threadId: THREAD, epoch: this.epoch, events })
    if (!outcome.ok) throw new Error('append refused')
    this.head = outcome.head
    return events
  }

  async appendTo(args: {
    threadId: string
    bodies: readonly RecordEventBody[]
  }): Promise<RecordEvent[]> {
    const events = chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-1'),
      epoch: this.epoch,
      at: AT,
      bodies: args.bodies,
      from: await this.plane.head({ threadId: args.threadId }),
    })
    const outcome = await this.plane.append({
      threadId: args.threadId,
      epoch: this.epoch,
      events,
    })
    if (!outcome.ok) throw new Error('append refused')
    return events
  }

  hashAt(events: readonly RecordEvent[], seq: number): string {
    const event = events.find((candidate) => candidate.seq === seq)
    if (event === undefined) throw new Error(`no event ${seq}`)
    return chainHash(event)
  }

  open(userId: string = OWNER, version: number = STREAM_PROTOCOL_VERSION): SubscriptionSession {
    return this.follow.open({
      userId,
      version,
      surface: EStreamSurface.Web,
      send: (message) => {
        this.sent.push(message)
        return Buffer.byteLength(JSON.stringify(message))
      },
      bufferedAmount: () => this.buffered,
      close: (code) => this.closedWith.push(code),
    })
  }

  sendForeign(frame: OutgoingFrame): void {
    this.sent.push(frame)
  }

  async subscribe(args: {
    session: SubscriptionSession
    id?: string
    sessionId?: string
    threadId?: string
    afterSeq?: number
    afterHash?: string
    tailViewVersion?: number
  }): Promise<void> {
    const message: StreamSubscriptionMessage = {
      type: 'subscribe',
      id: args.id ?? 'sub-1',
      kind: EStreamSubscribeKind.Session,
      sessionId: args.sessionId ?? SESSION,
      ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
      ...(args.afterSeq === undefined ? {} : { afterSeq: args.afterSeq }),
      ...(args.afterHash === undefined ? {} : { afterHash: args.afterHash }),
      ...(args.tailViewVersion === undefined ? {} : { tailViewVersion: args.tailViewVersion }),
    }
    await args.session.handle(message)
  }

  frames<T extends OutgoingFrame['type']>(type: T): Extract<OutgoingFrame, { type: T }>[] {
    return this.sent.filter(
      (message): message is Extract<OutgoingFrame, { type: T }> => message.type === type,
    )
  }

  latestLease(): { epoch: number; holderHostId: number | null; live: boolean } | undefined {
    const frame = this.frames('view').at(-1)
    if (frame === undefined) return undefined
    return frame.name === 'session' ? frame.value.status.lease : frame.value.lease
  }

  seqs(): number[] {
    return this.frames('events').flatMap((frame) => frame.events.map((event) => Number(event.seq)))
  }

  emitGap(): void {
    for (const listener of [...this.gapListeners]) listener()
  }

  async settled(): Promise<void> {
    await Bun.sleep(30)
  }

  async untilSeq(seq: number): Promise<void> {
    await until(() => this.seqs().includes(seq), `seq ${seq}`)
  }

  dispose(): void {
    this.follow.close()
  }
}
