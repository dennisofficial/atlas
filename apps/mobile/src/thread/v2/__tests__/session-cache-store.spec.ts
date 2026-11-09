import { describe, expect, it } from 'bun:test'

import { SESSION_CACHE_LIMIT, type SessionWindow } from '@dltech/atlas-client/stream'

import { failingJsonStore, memoryJsonStore } from '../../../storage/json-store'
import { createStoredSessionCache } from '../session-cache-store'

const windowAt = (seq: number): SessionWindow => ({
  events: [],
  visibility: { spans: [] },
  cursor: { seq, hash: `h${seq}` },
})

const setup = (args: { store?: ReturnType<typeof memoryJsonStore> } = {}) => {
  const store = args.store ?? memoryJsonStore()
  let stamp = 0
  const cache = createStoredSessionCache({
    store,
    now: () => {
      stamp += 1
      return stamp
    },
  })
  return { cache, store }
}

describe('the stored session cache', () => {
  it('loads the window it saved', async () => {
    const { cache } = setup()

    await cache.save({ sessionId: 's1', window: windowAt(7) })

    expect(await cache.load('s1')).toEqual(windowAt(7))
    expect(await cache.load('s2')).toBeUndefined()
  })

  it('replaces a window with the newer one', async () => {
    const { cache } = setup()

    await cache.save({ sessionId: 's1', window: windowAt(1) })
    await cache.save({ sessionId: 's1', window: windowAt(2) })

    expect(await cache.load('s1')).toEqual(windowAt(2))
  })

  it('reads a record of another version as nothing', async () => {
    const { cache, store } = setup()
    await store.write('s1.json', { version: 99, savedAt: 1, window: windowAt(3) })

    expect(await cache.load('s1')).toBeUndefined()
  })

  it('reads a malformed record as nothing', async () => {
    const { cache, store } = setup()
    await store.write('s1.json', 'garbage')

    expect(await cache.load('s1')).toBeUndefined()
  })

  it('keeps the newest windows up to the limit', async () => {
    const { cache, store } = setup()
    for (let index = 0; index < SESSION_CACHE_LIMIT; index += 1) {
      await cache.save({ sessionId: `s${index}`, window: windowAt(index) })
    }

    await cache.save({ sessionId: 'fresh', window: windowAt(200) })

    expect(await cache.load('fresh')).toEqual(windowAt(200))
    expect(await cache.load('s0')).toBeUndefined()
    expect(await cache.load('s1')).toEqual(windowAt(1))
    const windows = (await store.keys()).filter((name) => name !== 'index')
    expect(windows).toHaveLength(SESSION_CACHE_LIMIT)
    expect(windows).not.toContain('s0.json')
  })

  it('never throws when the store fails', async () => {
    const cache = createStoredSessionCache({ store: failingJsonStore(), now: () => 1 })

    await cache.save({ sessionId: 's1', window: windowAt(1) })

    expect(await cache.load('s1')).toBeUndefined()
  })
})
