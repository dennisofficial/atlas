import { describe, expect, it } from 'bun:test'
import { EStreamResetReason } from '@dltech/atlas-protocol'

import { memorySessionCache, type SessionCache } from '../session-cache'
import {
  createSessionFollower,
  HYDRATE_TIMEOUT_MS,
  type SessionFollower,
} from '../session-follower'
import { applyPage, EMPTY_WINDOW } from '../session-window'
import { createFakeScheduler, eventsMessage, headOf, mintUserEvents, settle } from './support'

const setup = (cache: SessionCache = memorySessionCache()) => {
  const clock = createFakeScheduler()
  const follower: SessionFollower = createSessionFollower({
    sessionId: 'session-1',
    cache,
    scheduler: clock.scheduler,
    onResnap: () => undefined,
  })
  return { follower, clock }
}

const cachedWindowOf = (count: number) => {
  const events = mintUserEvents({ count })
  return {
    events,
    window: applyPage({
      window: EMPTY_WINDOW,
      page: { events: events.map((event) => ({ ...event })), head: headOf(events) },
    }),
  }
}

describe('the session follower with a cache', () => {
  it('paints the cached window first and exposes its cursor', async () => {
    const cache = memorySessionCache()
    const { events, window } = cachedWindowOf(3)
    await cache.save({ sessionId: 'session-1', window })
    const { follower } = setup(cache)

    expect(follower.getSnapshot().events).toEqual([])
    await follower.hydrated

    expect(follower.getSnapshot().events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(follower.cursor()).toEqual(headOf(events))
    expect(follower.getSnapshot().fromCache).toBe(true)
  })

  it('stops calling a cached window cached once a page lands', async () => {
    const cache = memorySessionCache()
    await cache.save({ sessionId: 'session-1', window: cachedWindowOf(2).window })
    const { follower } = setup(cache)
    await follower.hydrated
    expect(follower.getSnapshot().fromCache).toBe(true)

    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 3 }), live: true }),
    )

    expect(follower.getSnapshot().fromCache).toBe(false)
  })

  it('stops calling a cached window cached once a reset throws it away', async () => {
    const cache = memorySessionCache()
    const { events, window } = cachedWindowOf(3)
    await cache.save({ sessionId: 'session-1', window })
    const { follower } = setup(cache)
    await follower.hydrated
    expect(follower.cursor()).toEqual(headOf(events))
    expect(follower.getSnapshot().fromCache).toBe(true)

    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 0,
    })

    expect(follower.getSnapshot().cursor).toBeUndefined()
    expect(follower.getSnapshot().fromCache).toBe(false)
  })

  it('never calls an empty cache window cached', async () => {
    const cache = memorySessionCache()
    await cache.save({ sessionId: 'session-1', window: EMPTY_WINDOW })
    const { follower } = setup(cache)

    await follower.hydrated

    expect(follower.getSnapshot().fromCache).toBe(false)
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
    expect(follower.getSnapshot().fromCache).toBe(false)
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
})
