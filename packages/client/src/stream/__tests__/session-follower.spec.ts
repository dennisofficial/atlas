import { describe, expect, it } from 'bun:test'
import { ESessionStatus } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  EStreamErrorCode,
  EStreamResetReason,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { EStreamConnectionState } from '../connection-machine'
import { memorySessionCache, type SessionCache } from '../session-cache'
import { createSessionFollower, ESessionConnection, HYDRATE_TIMEOUT_MS } from '../session-follower'
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
    follower.handleMessage({ type: 'overlay', id: 's1', key, afterSeq: 0, blocks: [] })
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

  it('goes outdated on an unreadable event and ignores every message after it', () => {
    const { follower, resnaps } = setup()
    const warned: unknown[][] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args)
    try {
      follower.setConnection(EStreamConnectionState.Open)
      const events = mintUserEvents({ count: 3 })
      const raw = [{ ...events[0] }, { seq: 2, type: 'from-the-future' }, { ...events[2] }]
      follower.handleMessage({
        type: 'events',
        id: 's1',
        events: raw,
        head: headOf(events),
        live: true,
      })
      follower.handleMessage({
        type: 'events',
        id: 's1',
        events: [{ seq: 9, type: 'also-unknown' }],
        head: headOf(events),
        live: true,
      })
      follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(0, 1), live: true }))
      follower.setConnection(EStreamConnectionState.Backoff)
      follower.setConnection(EStreamConnectionState.Open)
      const snapshot = follower.getSnapshot()
      expect(snapshot.connection).toBe(ESessionConnection.Outdated)
      expect(snapshot.events.map((event) => event.seq)).toEqual([1])
      expect(snapshot.cursor?.seq).toBe(1)
      expect(warned).toHaveLength(1)
      expect(String(warned[0]?.[0])).toContain('2')
      expect(resnaps).toEqual([])
    } finally {
      console.warn = original
    }
  })

  it('reads an unreadable event as stale when the host knows types this client does not', () => {
    const { follower } = setup()
    const warned = console.warn
    console.warn = () => undefined
    try {
      follower.setServerEventTypes(['from-the-future', 'user-said'])
      follower.setConnection(EStreamConnectionState.Open)
      const events = mintUserEvents({ count: 2 })
      follower.handleMessage({
        type: 'events',
        id: 's1',
        events: [{ ...events[0] }, { seq: 2, type: 'from-the-future' }],
        head: headOf(events),
        live: true,
      })
      expect(follower.getSnapshot().connection).toBe(ESessionConnection.Stale)
    } finally {
      console.warn = warned
    }
  })

  it('stays live when the host knows only types this client can read', () => {
    const { follower } = setup()
    follower.setServerEventTypes(['user-said'])
    follower.setConnection(EStreamConnectionState.Open)
    const events = mintUserEvents({ count: 2 })
    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.Live)
  })

  it('goes back to catching up and drops the open overlay when it resubscribes', () => {
    const { follower } = setup()
    const key = { runId: 'run-1', step: 1, attempt: 0 }
    follower.setConnection(EStreamConnectionState.Open)
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 1 }), live: true }),
    )
    follower.handleMessage({ type: 'overlay', id: 's1', key, afterSeq: 0, blocks: [] })
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
  describe('when the cache stays silent', () => {
    const hangingCache = (): SessionCache & { answer(): void } => {
      const saved = applyPage({
        window: EMPTY_WINDOW,
        page: {
          events: mintUserEvents({ count: 2 }).map((event) => ({ ...event })),
          head: headOf(mintUserEvents({ count: 2 })),
        },
      })
      let answer: () => void = () => undefined
      return {
        load: () =>
          new Promise((resolve) => {
            answer = () => resolve(saved)
          }),
        save: () => Promise.resolve(),
        answer: () => answer(),
      }
    }

    it('settles hydrated after the timeout', async () => {
      const cache = hangingCache()
      const { follower, clock } = setup(cache)
      let done = false
      void follower.hydrated.then(() => void (done = true))
      clock.advance(HYDRATE_TIMEOUT_MS - 1)
      await settle()
      expect(done).toBe(false)
      clock.advance(1)
      await settle()
      expect(done).toBe(true)
    })

    it('ignores a cache window that arrives after the timeout', async () => {
      const cache = hangingCache()
      const { follower, clock } = setup(cache)
      clock.advance(HYDRATE_TIMEOUT_MS)
      await follower.hydrated
      cache.answer()
      await settle()
      expect(follower.getSnapshot().events).toEqual([])
      expect(follower.cursor()).toBeUndefined()
    })

    it('leaves no timer behind once the cache answers', async () => {
      const { follower, clock } = setup()
      await follower.hydrated
      expect(clock.pendingCount()).toBe(0)
    })

    it('leaves no timer behind when the cache fails', async () => {
      const failing: SessionCache = {
        load: () => Promise.reject(new Error('disk')),
        save: () => Promise.resolve(),
      }
      const { follower, clock } = setup(failing)
      await follower.hydrated
      expect(clock.pendingCount()).toBe(0)
    })
  })

  it('keeps an error frame in the snapshot until the next events page', () => {
    const { follower } = setup()
    follower.handleMessage({ type: 'error', id: 's1', code: EStreamErrorCode.Internal })
    expect(follower.getSnapshot().error).toBe(EStreamErrorCode.Internal)
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 1 }), live: true }),
    )
    expect(follower.getSnapshot().error).toBeUndefined()
  })
})
