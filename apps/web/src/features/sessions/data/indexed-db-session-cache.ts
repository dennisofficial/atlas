import { v2EventSchema } from '@dltech/atlas-core'
import type { SessionCache, SessionWindow } from '@dltech/atlas-client/stream'

export const SESSION_CACHE_DB = 'atlas-stream'
export const SESSION_CACHE_STORE = 'windows'
export const SESSION_CACHE_LIMIT = 20

const DB_VERSION = 1
const RECORD_VERSION = 1

type CachedWindow = { version: number; savedAt: number; window: SessionWindow }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isCursor = (value: unknown): boolean =>
  value === undefined ||
  (isRecord(value) && typeof value.seq === 'number' && typeof value.hash === 'string')

const isSpan = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.createdAt === 'number' &&
  typeof value.fromSeq === 'number' &&
  typeof value.throughSeq === 'number' &&
  typeof value.keepSurvivors === 'boolean'

const isWindow = (value: unknown): value is SessionWindow =>
  isRecord(value) &&
  Array.isArray(value.events) &&
  value.events.every((event) => v2EventSchema.safeParse(event).success) &&
  isRecord(value.visibility) &&
  Array.isArray(value.visibility.spans) &&
  value.visibility.spans.every(isSpan) &&
  isCursor(value.cursor)

const isCachedWindow = (value: unknown): value is CachedWindow =>
  isRecord(value) &&
  value.version === RECORD_VERSION &&
  typeof value.savedAt === 'number' &&
  isWindow(value.window)

const requestDone = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

const openDatabase = (factory: IDBFactory): Promise<IDBDatabase> =>
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
  isRecord(value) && typeof value.savedAt === 'number' ? value.savedAt : 0

const evictOldest = async (store: IDBObjectStore): Promise<void> => {
  const [keys, values] = await Promise.all([
    requestDone(store.getAllKeys()),
    requestDone(store.getAll()),
  ])
  const excess = keys.length - SESSION_CACHE_LIMIT
  if (excess <= 0) return
  const oldest = keys
    .map((key, index) => ({ key, savedAt: savedAtOf(values[index]) }))
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(0, excess)
  for (const { key } of oldest) store.delete(key)
}

export function createIndexedDbSessionCache(args: {
  factory: IDBFactory | undefined
  now: () => number
}): SessionCache {
  const { factory, now } = args
  const withDatabase = async <T>({
    fallback,
    use,
  }: {
    fallback: T
    use: (db: IDBDatabase) => Promise<T>
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
          return isCachedWindow(value) ? value.window : undefined
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
          const record: CachedWindow = { version: RECORD_VERSION, savedAt: now(), window }
          await requestDone(store.put(record, sessionId))
          await evictOldest(store)
          await done
        },
      }),
  }
}

export const browserSessionCache = (): SessionCache =>
  createIndexedDbSessionCache({
    factory: typeof indexedDB === 'undefined' ? undefined : indexedDB,
    now: () => Date.now(),
  })
