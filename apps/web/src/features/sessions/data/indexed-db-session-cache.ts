import type { SessionCache, SessionWindow } from '@dltech/atlas-client/stream'

export const SESSION_CACHE_DB = 'atlas-stream'
export const SESSION_CACHE_STORE = 'windows'
export const SESSION_CACHE_LIMIT = 20

const DB_VERSION = 1
const RECORD_VERSION = 1

type CachedWindow = { version: number; savedAt: number; window: SessionWindow }

const isCachedWindow = (value: unknown): value is CachedWindow => {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<CachedWindow>
  return (
    record.version === RECORD_VERSION &&
    typeof record.savedAt === 'number' &&
    typeof record.window === 'object' &&
    record.window !== null &&
    Array.isArray(record.window.events)
  )
}

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

const savedAtOf = (value: unknown): number => (isCachedWindow(value) ? value.savedAt : 0)

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
