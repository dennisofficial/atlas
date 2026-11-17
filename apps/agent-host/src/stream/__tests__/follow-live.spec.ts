import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  chainEvents,
  EMPTY_VISIBILITY,
  GENESIS_HASH,
  chainHash,
  isVisible,
  stepVisibility,
  toRunId,
  toThreadId,
  v2EventSchema,
  type LogHead,
  type V2Body,
  type V2Event,
  type VisibilityState,
} from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { StreamServerMessage } from '@dltech/atlas-protocol'

import { startPgChangeFeed, type PgChangeFeed } from '../../bus/pg-change-feed'
import { createFollowSubscriptions, type FollowSubscriptions } from '../follow-port'
import { createSessionStream, type SessionStream } from '../session-stream'
import { systemHostTimers } from '../system-timers'
import { createUserSlots } from '../user-slots'

const testDb = useTestDatabase()

const SESSION = 'live-session'
const THREAD = 'live-thread'
const OWNER = 'user-a'
const AT = '2026-11-02T12:00:00.000Z'

const said = (text: string): V2Body => ({ type: 'user-said', text })

class ClientWindow {
  private state: VisibilityState = EMPTY_VISIBILITY
  private window: V2Event[] = []
  lastLive = false
  received: number[] = []

  constructor(readonly frames: AsyncGenerator<StreamServerMessage>) {}

  async followUntil(seq: number): Promise<void> {
    while (this.maxSeq() < seq) this.apply(await this.nextFrame())
  }

  close(): void {
    void this.frames.return(undefined)
  }

  apply(frame: StreamServerMessage): void {
    if (frame.type === 'reset') {
      this.state = EMPTY_VISIBILITY
      this.window = []
      return
    }
    if (frame.type !== 'events') return
    this.lastLive = frame.live
    for (const raw of frame.events) {
      const event = v2EventSchema.parse(raw)
      this.state = stepVisibility(this.state, event)
      this.window.push(event)
    }
    this.window = this.window.filter((event) => isVisible(this.state, event))
    this.received = [...this.received, ...frame.events.map((raw) => Number(raw.seq))]
  }

  seqs(): number[] {
    return this.window.map((event) => event.seq)
  }

  nextFrame(): Promise<StreamServerMessage> {
    return this.frames.next().then((step) => {
      if (step.done === true) throw new Error('the stream ended')
      return step.value
    })
  }

  private maxSeq(): number {
    return this.received.length === 0 ? 0 : Math.max(...this.received)
  }
}

describe('follow a session over a real stream', () => {
  let plane: ControlPlane
  let feed: PgChangeFeed
  let follow: FollowSubscriptions
  let stream: SessionStream
  let epoch = 0
  let head: LogHead = { seq: 0, hash: GENESIS_HASH }
  const clients: ClientWindow[] = []

  const append = async (bodies: readonly V2Body[]): Promise<V2Event[]> => {
    const events = chainEvents({
      threadId: toThreadId(THREAD),
      runId: toRunId('run-1'),
      epoch,
      at: AT,
      bodies,
      from: head,
    })
    const outcome = await plane.append({ threadId: THREAD, epoch, events })
    if (!outcome.ok) throw new Error('append refused')
    head = outcome.head
    return events
  }

  const connect = async (afterSeq?: { seq: number; hash: string }): Promise<ClientWindow> => {
    const window = new ClientWindow(
      stream.follow({
        userId: OWNER,
        sessionId: SESSION,
        ...(afterSeq === undefined ? {} : { afterSeq: afterSeq.seq, afterHash: afterSeq.hash }),
      }),
    )
    clients.push(window)
    expect((await window.nextFrame()).type).toBe('ready')
    return window
  }

  beforeEach(async () => {
    plane = new ControlPlane({ store: new PostgresControlStore(testDb().db) })
    const gapped = new Promise<void>((resolve) => {
      feed = startPgChangeFeed({ url: testDb().url })
      const off = feed.onGap(() => {
        off()
        resolve()
      })
    })
    await gapped
    follow = createFollowSubscriptions({
      plane,
      feed,
      timers: systemHostTimers,
      log: undefined,
    })
    stream = createSessionStream({
      users: createUserSlots({ limit: 20 }),
      timers: systemHostTimers,
      eventTypes: [],
      log: undefined,
    })
    stream.start({ subscriptions: follow })
    await plane.createSession({
      sessionId: SESSION,
      userId: OWNER,
      projectId: 'project-1',
      mainThreadId: THREAD,
    })
    epoch = (await plane.grant({ sessionId: SESSION, hostId: 1 })).epoch
    head = await plane.head({ threadId: THREAD })
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    stream.stop()
    follow.close()
    await feed.close()
  })

  it('delivers an append live within a second', async () => {
    const window = await connect()
    await append([said('one')])
    const started = Date.now()
    await window.followUntil(1)
    expect(Date.now() - started).toBeLessThan(1_000)
    await append([said('two')])
    await window.followUntil(2)
    expect(window.lastLive).toBe(true)
    expect(window.seqs()).toEqual([1, 2])
  })

  it('resumes after reconnect with exactly the missed events', async () => {
    const first = await connect()
    const events = await append([said('a'), said('b'), said('c')])
    await first.followUntil(3)
    first.close()
    await append([said('d'), said('e')])
    const second = await connect({ seq: 3, hash: chainHash(events[2] as V2Event) })
    await second.followUntil(5)
    expect(second.received).toEqual([4, 5])
  })

  it('folds a rewind client-side to match a fresh tail', async () => {
    const live = await connect()
    await append([said('a'), said('b'), said('c'), said('d')])
    await live.followUntil(4)
    await append([{ type: 'history-rewound', toSeq: 2 }, said('e')])
    await live.followUntil(6)
    const fresh = await connect()
    await fresh.followUntil(6)
    expect(live.seqs()).toEqual([1, 2, 6])
    expect(fresh.seqs()).toEqual(live.seqs())
  })
})
