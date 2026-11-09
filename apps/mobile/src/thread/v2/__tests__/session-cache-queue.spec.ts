import { describe, expect, it } from 'bun:test'

import type { SessionCache, SessionWindow } from '@dltech/atlas-client/stream'

import { memoryJsonStore } from '../../../storage/json-store'
import { queuedSessionCache } from '../session-cache-queue'
import { createStoredSessionCache } from '../session-cache-store'

const windowAt = (seq: number): SessionWindow => ({
  events: [],
  visibility: { spans: [] },
  cursor: { seq, hash: `h${seq}` },
})

const setup = () => {
  const store = memoryJsonStore()
  const cache = queuedSessionCache(createStoredSessionCache({ store, now: () => 1 }))
  return { cache, store }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the queued session cache', () => {
  it('runs saves in the order they were asked for', async () => {
    const order: number[] = []
    const slow = (seq: number): Promise<void> =>
      new Promise((resolve) =>
        setTimeout(
          () => {
            order.push(seq)
            resolve()
          },
          seq === 1 ? 10 : 0,
        ),
      )
    const cache = queuedSessionCache({
      load: () => Promise.resolve(undefined),
      save: ({ window }) => slow(window.cursor?.seq ?? 0),
    } as SessionCache)

    await Promise.all([
      cache.save({ sessionId: 's1', window: windowAt(1) }),
      cache.save({ sessionId: 's2', window: windowAt(2) }),
    ])

    expect(order).toEqual([1, 2])
  })

  it('keeps taking work after an operation fails', async () => {
    const attempts: string[] = []
    const cache = queuedSessionCache({
      load: () => Promise.resolve(undefined),
      save: ({ sessionId }) => {
        attempts.push(sessionId)
        return sessionId === 'first' ? Promise.reject(new Error('disk')) : Promise.resolve()
      },
    } as SessionCache)

    await expect(cache.save({ sessionId: 'first', window: windowAt(1) })).rejects.toThrow('disk')
    await cache.save({ sessionId: 'second', window: windowAt(2) })

    expect(attempts).toEqual(['first', 'second'])
  })

  it('lets nothing through once it is stopped and drained', async () => {
    const { cache, store } = setup()
    await cache.save({ sessionId: 's1', window: windowAt(1) })

    cache.stop()
    await cache.drain()
    await store.clear()
    await cache.save({ sessionId: 's1', window: windowAt(2) })
    await settle()

    expect(await cache.load('s1')).toBeUndefined()
    expect(await store.keys()).toEqual([])
  })

  it('drains a save that was already scheduled when it was stopped', async () => {
    const { cache, store } = setup()
    const saving = cache.save({ sessionId: 's1', window: windowAt(1) })

    cache.stop()
    await Promise.all([saving, cache.drain()])
    await store.clear()

    expect(await store.keys()).toEqual([])
  })
})
