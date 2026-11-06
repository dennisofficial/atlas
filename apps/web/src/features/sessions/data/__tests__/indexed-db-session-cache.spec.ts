import { describe, expect, it } from 'bun:test'
import { IDBFactory } from 'fake-indexeddb'

import type { SessionWindow } from '@dltech/atlas-client/stream'

import {
  createIndexedDbSessionCache,
  SESSION_CACHE_DB,
  SESSION_CACHE_LIMIT,
  SESSION_CACHE_STORE,
} from '../indexed-db-session-cache'

const windowAt = (seq: number): SessionWindow => ({
  events: [],
  visibility: { spans: [] },
  cursor: { seq, hash: `h${seq}` },
})

const clock = () => {
  let time = 0
  return () => {
    time += 1
    return time
  }
}

const putRaw = (args: { factory: IDBFactory; key: string; value: unknown }): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = args.factory.open(SESSION_CACHE_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(SESSION_CACHE_STORE)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(SESSION_CACHE_STORE, 'readwrite')
      tx.objectStore(SESSION_CACHE_STORE).put(args.value, args.key)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })

describe('createIndexedDbSessionCache', () => {
  it('loads what it saved', async () => {
    const cache = createIndexedDbSessionCache({ factory: new IDBFactory(), now: clock() })

    await cache.save({ sessionId: 's1', window: windowAt(7) })

    expect(await cache.load('s1')).toEqual(windowAt(7))
    expect(await cache.load('s2')).toBeUndefined()
  })

  it('replaces a saved window with the newer one', async () => {
    const cache = createIndexedDbSessionCache({ factory: new IDBFactory(), now: clock() })

    await cache.save({ sessionId: 's1', window: windowAt(1) })
    await cache.save({ sessionId: 's1', window: windowAt(2) })

    expect(await cache.load('s1')).toEqual(windowAt(2))
  })

  it('evicts the least recently saved session past the limit', async () => {
    const cache = createIndexedDbSessionCache({ factory: new IDBFactory(), now: clock() })

    for (let index = 0; index < SESSION_CACHE_LIMIT; index += 1) {
      await cache.save({ sessionId: `s${index}`, window: windowAt(index) })
    }
    await cache.save({ sessionId: 's0', window: windowAt(100) })
    await cache.save({ sessionId: 'fresh', window: windowAt(200) })

    expect(await cache.load('s1')).toBeUndefined()
    expect(await cache.load('s0')).toEqual(windowAt(100))
    expect(await cache.load('s2')).toEqual(windowAt(2))
    expect(await cache.load('fresh')).toEqual(windowAt(200))
  })

  it('loads a record of another version as nothing', async () => {
    const factory = new IDBFactory()
    await putRaw({ factory, key: 's1', value: { version: 2, savedAt: 1, window: windowAt(3) } })
    const cache = createIndexedDbSessionCache({ factory, now: clock() })

    expect(await cache.load('s1')).toBeUndefined()
  })

  it('loads a malformed record as nothing', async () => {
    const factory = new IDBFactory()
    await putRaw({ factory, key: 's1', value: 'garbage' })
    const cache = createIndexedDbSessionCache({ factory, now: clock() })

    expect(await cache.load('s1')).toBeUndefined()
  })

  it('never throws when the database cannot open', async () => {
    const failing = {
      open: () => {
        throw new Error('blocked')
      },
    } as unknown as IDBFactory
    const cache = createIndexedDbSessionCache({ factory: failing, now: clock() })

    await cache.save({ sessionId: 's1', window: windowAt(1) })
    expect(await cache.load('s1')).toBeUndefined()
  })

  it('never throws without IndexedDB at all', async () => {
    const cache = createIndexedDbSessionCache({ factory: undefined, now: clock() })

    await cache.save({ sessionId: 's1', window: windowAt(1) })
    expect(await cache.load('s1')).toBeUndefined()
  })
})
