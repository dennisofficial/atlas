import { v2EventSchema, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

import {
  defaultIndexedDbFactory,
  type IdbDatabase,
  type IdbFactory,
  type IdbObjectStore,
  type IdbRequest,
  type IdbTransaction,
} from './indexed-db-types'
import type { SessionCache } from './session-cache'
import {
  SESSION_CACHE_LIMIT,
  SESSION_CACHE_RECORD_VERSION,
  windowFromRecord,
  type CachedWindow,
} from './session-cache-record'
import type { SessionWindow } from './session-window'

export { SESSION_CACHE_LIMIT }

export const SESSION_CACHE_DB = 'atlas-stream'
export const SESSION_CACHE_STORE = 'windows'

const DB_VERSION = 1

const requestDone = <T>(request: IdbRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const transactionDone = (tx: IdbTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

const openDatabase = (factory: IdbFactory): Promise<IdbDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(SESSION_CACHE_DB, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SESSION_CACHE_STORE)) {
        request.result.createObjectStore(SESSION_CACHE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('session cache blocked'))
  })

const savedAtOf = (value: unknown): number =>
  typeof value === 'object' && value !== null && 'savedAt' in value ? Number(value.savedAt) : 0

const evictOldest = async (store: IdbObjectStore): Promise<void> => {
  const [keys, values] = await Promise.all([
    requestDone(store.getAllKeys()),
    requestDone(store.getAll()),
  ])
  const excess = keys.length - SESSION_CACHE_LIMIT
  if (excess <= 0) return
  const oldest = keys
    .map((key, index) => ({ key: String(key), savedAt: savedAtOf(values[index]) }))
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(0, excess)
  for (const { key } of oldest) store.delete(key)
}

export function createIndexedDbSessionCache(args: {
  factory: IdbFactory | undefined
  now: () => number
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionCache {
  const { factory, now } = args
  const eventSchema = args.eventSchema ?? v2EventSchema
  const withDatabase = async <T>({
    fallback,
    use,
  }: {
    fallback: T
    use: (db: IdbDatabase) => Promise<T>
  }): Promise<T> => {
    if (factory === undefined) return fallback
    try {
      const db = await openDatabase(factory)
      try {
        return await use(db)
      } finally {
        db.close()
      }
    } catch {
      return fallback
    }
  }

  return {
    load: (sessionId) =>
      withDatabase<SessionWindow | undefined>({
        fallback: undefined,
        use: async (db) => {
          const tx = db.transaction(SESSION_CACHE_STORE, 'readonly')
          const value = await requestDone(tx.objectStore(SESSION_CACHE_STORE).get(sessionId))
          return windowFromRecord({ value, eventSchema })
        },
      }),
    save: ({ sessionId, window }) =>
      withDatabase<void>({
        fallback: undefined,
        use: async (db) => {
          const tx = db.transaction(SESSION_CACHE_STORE, 'readwrite')
          const done = transactionDone(tx)
          done.catch(() => undefined)
          const store = tx.objectStore(SESSION_CACHE_STORE)
          const record: CachedWindow = {
            version: SESSION_CACHE_RECORD_VERSION,
            savedAt: now(),
            window,
          }
          await requestDone(store.put(record, sessionId))
          await evictOldest(store)
          await done
        },
      }),
  }
}

export const browserSessionCache = (eventSchema?: z.ZodType<V2Event>): SessionCache =>
  createIndexedDbSessionCache({
    factory: defaultIndexedDbFactory(),
    now: () => Date.now(),
    eventSchema,
  })

export const clearBrowserSessionCache = (
  factory: IdbFactory | undefined = defaultIndexedDbFactory(),
): Promise<void> =>
  factory === undefined
    ? Promise.resolve()
    : new Promise((resolve) => {
        const request = factory.open(SESSION_CACHE_DB, DB_VERSION)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(SESSION_CACHE_STORE)) {
            request.result.createObjectStore(SESSION_CACHE_STORE)
          }
        }
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(SESSION_CACHE_STORE, 'readwrite')
          tx.objectStore(SESSION_CACHE_STORE).clear()
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            resolve()
          }
        }
      })
