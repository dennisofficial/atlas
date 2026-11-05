import { describe, expect, it } from 'bun:test'
import { ESessionStatus } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  EStreamResetReason,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { EStreamConnectionState } from '../connection-machine'
import { memorySessionCache, type SessionCache } from '../session-cache'
import { createSessionFollower, ESessionConnection } from '../session-follower'
import { EMPTY_WINDOW, applyPage } from '../session-window'
import { createFakeScheduler, eventsMessage, headOf, mintUserEvents, settle } from './support'

const statusView = (params: { at: number; state?: ESessionStatus }): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'status',
  at: params.at,
  value: {
    state: params.state ?? ESessionStatus.Idle,
    lease: { epoch: 1, holderHostId: 7, live: true },
  },
})

const setup = (cache: SessionCache = memorySessionCache()) => {
  const clock = createFakeScheduler()
  const resnaps: string[] = []
  const follower = createSessionFollower({
    sessionId: 'session-1',
    cache,
    scheduler: clock.scheduler,
    onResnap: () => resnaps.push('resnap'),
  })
  return { follower, clock, resnaps, cache }
}

describe('the session follower', () => {
  it('applies event pages to the window and moves the cursor', () => {
    const { follower } = setup()
    const events = mintUserEvents({ count: 3 })
    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
    const snapshot = follower.getSnapshot()
    expect(snapshot.events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(snapshot.cursor).toEqual(headOf(events))
  })

  it('discards a view whose position is behind the cursor', () => {
    const { follower } = setup()
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 20 }), live: true }),
    )
    follower.handleMessage(statusView({ at: 5, state: ESessionStatus.Thinking }))
    expect(follower.getSnapshot().status).toBeUndefined()
    follower.handleMessage(statusView({ at: 20, state: ESessionStatus.Thinking }))
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.Thinking)
  })

  it('keeps the latest accepted view and replaces it with a newer one', () => {
    const { follower } = setup()
    follower.handleMessage(statusView({ at: 0, state: ESessionStatus.Sent }))
    follower.handleMessage(statusView({ at: 3, state: ESessionStatus.Idle }))
    expect(follower.getSnapshot().status?.state).toBe(ESessionStatus.Idle)
  })

  it('sends a resnap request on a delta gap', () => {
    const { follower, resnaps } = setup()
    const key = { runId: 'run-1', step: 1, attempt: 0 }
    follower.handleMessage({ type: 'overlay', id: 's1', key, blocks: [] })
    follower.handleMessage({
      type: 'delta',
      id: 's1',
      key,
      block: 'b0',
      kind: EStreamBlockKind.Text,
      from: 12,
      text: 'x',
    })
    expect(resnaps).toEqual(['resnap'])
  })

  it('clears the window and status on reset', () => {
    const { follower } = setup()
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 3 }), live: true }),
    )
    follower.handleMessage(statusView({ at: 3 }))
    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 1,
    })
    const snapshot = follower.getSnapshot()
    expect(snapshot.events).toEqual([])
    expect(snapshot.cursor).toBeUndefined()
    expect(snapshot.status).toBeUndefined()
  })

  it('derives the connection from the machine phase and the live flag', () => {
    const { follower } = setup()
    const seen = (): ESessionConnection => follower.getSnapshot().connection
    follower.setConnection(EStreamConnectionState.Open)
    expect(seen()).toBe(ESessionConnection.CatchingUp)
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 2 }), live: false }),
    )
    expect(seen()).toBe(ESessionConnection.CatchingUp)
    follower.handleMessage(
      eventsMessage({
        id: 's1',
        events: mintUserEvents({
          count: 1,
          from: { seq: 2, hash: headOf(mintUserEvents({ count: 2 })).hash },
        }),
        live: true,
      }),
    )
    expect(seen()).toBe(ESessionConnection.Live)
    follower.setConnection(EStreamConnectionState.Backoff)
    expect(seen()).toBe(ESessionConnection.Reconnecting)
    follower.setConnection(EStreamConnectionState.Closed)
    expect(seen()).toBe(ESessionConnection.Offline)
    follower.setConnection(EStreamConnectionState.Open)
    expect(seen()).toBe(ESessionConnection.CatchingUp)
  })

  it('goes back to catching up and drops the open overlay when it resubscribes', () => {
    const { follower } = setup()
    const key = { runId: 'run-1', step: 1, attempt: 0 }
    follower.setConnection(EStreamConnectionState.Open)
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 1 }), live: true }),
    )
    follower.handleMessage({ type: 'overlay', id: 's1', key, blocks: [] })
    follower.markResubscribing()
    const snapshot = follower.getSnapshot()
    expect(snapshot.connection).toBe(ESessionConnection.CatchingUp)
    expect(snapshot.overlay).toBeUndefined()
  })

  it('keeps one snapshot object until something changes and notifies listeners', () => {
    const { follower } = setup()
    const first = follower.getSnapshot()
    expect(follower.getSnapshot()).toBe(first)
    let calls = 0
    const unsubscribe = follower.subscribe(() => void (calls += 1))
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 1 }), live: true }),
    )
    expect(calls).toBe(1)
    expect(follower.getSnapshot()).not.toBe(first)
    follower.handleMessage({ type: 'pong' })
    expect(calls).toBe(1)
    unsubscribe()
    follower.handleMessage(statusView({ at: 1 }))
    expect(calls).toBe(1)
  })

  it('paints the cached window first and exposes its cursor', async () => {
    const cache = memorySessionCache()
    const events = mintUserEvents({ count: 3 })
    const window = applyPage({
      window: EMPTY_WINDOW,
      page: { events: events.map((event) => ({ ...event })), head: headOf(events) },
    })
    await cache.save({ sessionId: 'session-1', window })
    const { follower } = setup(cache)
    expect(follower.getSnapshot().events).toEqual([])
    await follower.hydrated
    expect(follower.getSnapshot().events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(follower.cursor()).toEqual(headOf(events))
  })

  it('starts empty when the cache has nothing or fails to load', async () => {
    const failing: SessionCache = {
      load: () => Promise.reject(new Error('disk')),
      save: () => Promise.resolve(),
    }
    const { follower } = setup(failing)
    await follower.hydrated
    expect(follower.getSnapshot().events).toEqual([])
    expect(follower.cursor()).toBeUndefined()
  })

  it('saves the window after an events page, at most once a second', async () => {
    const saved: number[] = []
    const cache: SessionCache = {
      load: () => Promise.resolve(undefined),
      save: ({ window }) => {
        saved.push(window.cursor?.seq ?? 0)
        return Promise.resolve()
      },
    }
    const { follower, clock } = setup(cache)
    await follower.hydrated
    const log = mintUserEvents({ count: 3 })
    follower.handleMessage(eventsMessage({ id: 's1', events: log.slice(0, 1), live: true }))
    await settle()
    expect(saved).toEqual([1])
    follower.handleMessage(eventsMessage({ id: 's1', events: log.slice(1, 2), live: true }))
    follower.handleMessage(eventsMessage({ id: 's1', events: log.slice(2), live: true }))
    await settle()
    expect(saved).toEqual([1])
    clock.advance(1000)
    await settle()
    expect(saved).toEqual([1, 3])
  })
})
