import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  chainHash,
  GENESIS_HASH,
  type LogHead,
  toRunId,
  toThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import { EStreamSubscribeKind, type StreamServerMessage } from '@dltech/atlas-protocol'

import { createFollowSubscriptions, type FollowSubscriptions } from '../follow-port'
import type { FollowPlane } from '../follow-types'
import type { LiveSource } from '../live-source'
import type { StreamSubscriptionMessage, SubscriptionSession } from '../subscription-port'
import { FakeTimers } from './fake-timers'
import { until } from './test-client'

export const SESSION = 'session-1'
export const THREAD = 'thread-1'
export const OWNER = 'user-a'
const AT = '2026-11-02T12:00:00.000Z'

export const said = (text: string): V2Body => ({ type: 'user-said', text })

export class FollowRig {
  readonly store = new InMemoryControlStore()
  readonly plane = new ControlPlane({ store: this.store, clock: () => AT })
  readonly timers = new FakeTimers()
  readonly sent: StreamServerMessage[] = []
  readonly closedWith: number[] = []
  buffered = 0
  reads = 0
  onRead: (() => Promise<void>) | undefined
  readonly follow: FollowSubscriptions
  private epoch = 0
  private head: LogHead = { seq: 0, hash: GENESIS_HASH }

  statusReads = 0

  constructor(args: { live?: LiveSource } = {}) {
    const plane: FollowPlane = {
      readSession: (params) => this.plane.readSession(params),
      head: (params) => this.plane.head(params),
      readEvents: async (params) => {
        if (params.visible) {
          this.statusReads += 1
          return this.plane.readEvents(params)
        }
        this.reads += 1
        const page = await this.plane.readEvents(params)
        await this.onRead?.()
        return page
      },
      readInbox: (params) => this.plane.readInbox(params),
      currentLease: (params) => this.plane.currentLease(params),
      readBlob: (params) => this.plane.readBlob(params),
      hasMessageAfter: (params) => this.plane.hasMessageAfter(params),
    }
    this.follow = createFollowSubscriptions({
      plane,
      timers: this.timers,
      log: undefined,
      feed: this.store,
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

  async append(bodies: readonly V2Body[]): Promise<V2Event[]> {
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

  hashAt(events: readonly V2Event[], seq: number): string {
    const event = events.find((candidate) => candidate.seq === seq)
    if (event === undefined) throw new Error(`no event ${seq}`)
    return chainHash(event)
  }

  open(userId: string = OWNER): SubscriptionSession {
    return this.follow.open({
      userId,
      send: (message) => this.sent.push(message),
      bufferedAmount: () => this.buffered,
      close: (code) => this.closedWith.push(code),
    })
  }

  async subscribe(args: {
    session: SubscriptionSession
    id?: string
    sessionId?: string
    afterSeq?: number
    afterHash?: string
  }): Promise<void> {
    const message: StreamSubscriptionMessage = {
      type: 'subscribe',
      id: args.id ?? 'sub-1',
      kind: EStreamSubscribeKind.Session,
      sessionId: args.sessionId ?? SESSION,
      ...(args.afterSeq === undefined ? {} : { afterSeq: args.afterSeq }),
      ...(args.afterHash === undefined ? {} : { afterHash: args.afterHash }),
    }
    await args.session.handle(message)
  }

  frames<T extends StreamServerMessage['type']>(
    type: T,
  ): Extract<StreamServerMessage, { type: T }>[] {
    return this.sent.filter(
      (message): message is Extract<StreamServerMessage, { type: T }> => message.type === type,
    )
  }

  seqs(): number[] {
    return this.frames('events').flatMap((frame) => frame.events.map((event) => Number(event.seq)))
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
