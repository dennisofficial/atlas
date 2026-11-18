import { v2EventSchema, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

import {
  defaultIndexedDbFactory,
  defaultKeyRangeFactory,
  type IdbDatabase,
  type IdbFactory,
  type IdbKeyRangeFactory,
  type IdbObjectStore,
  type IdbRequest,
  type IdbTransaction,
} from './indexed-db-types'
import { logSnapshotOf } from './session-log-record'
import {
  SESSION_LOG_STRUCTURE_VERSION,
  type SessionLog,
  type SessionLogSnapshot,
} from './session-log'

export const SESSION_LOG_DB = 'atlas-stream'
export const SESSION_LOG_EVENTS_STORE = 'events'
export const SESSION_LOG_SNAPSHOTS_STORE = 'snapshots'
export const SESSION_LOG_LEGACY_STORES = ['windows'] as const

type LogRow = { sessionId: string; seq: number; event: V2Event }

type SnapshotRow = {
  sessionId: string
  snapshot: SessionLogSnapshot | undefined
  head: { seq: number; hash: string } | undefined
}

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
    const request = factory.open(SESSION_LOG_DB, SESSION_LOG_STRUCTURE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const legacy of SESSION_LOG_LEGACY_STORES) {
        if (db.objectStoreNames.contains(legacy)) db.deleteObjectStore(legacy)
      }
      if (!db.objectStoreNames.contains(SESSION_LOG_EVENTS_STORE)) {
        db.createObjectStore(SESSION_LOG_EVENTS_STORE, { keyPath: ['sessionId', 'seq'] })
      }
      if (!db.objectStoreNames.contains(SESSION_LOG_SNAPSHOTS_STORE)) {
        db.createObjectStore(SESSION_LOG_SNAPSHOTS_STORE, { keyPath: 'sessionId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('session log blocked'))
  })

const rowsOf = (value: unknown): readonly LogRow[] => {
  if (!Array.isArray(value)) return []
  return value.filter(
    (row): row is LogRow =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as LogRow).sessionId === 'string' &&
      typeof (row as LogRow).seq === 'number',
  )
}

const eventsOf = (rows: readonly LogRow[], schema: z.ZodType<V2Event>): readonly V2Event[] =>
  rows.flatMap((row) => (schema.safeParse(row.event).success ? [row.event] : []))

const readCursor = async (args: {
  store: IdbObjectStore
  range: unknown
  count: number
  direction: 'next' | 'prev'
  schema: z.ZodType<V2Event>
}): Promise<readonly V2Event[]> => {
  const rows: LogRow[] = []
  const request = args.store.openCursor(args.range, args.direction)
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor === null || rows.length >= args.count) {
        resolve()
        return
      }
      const [row] = rowsOf([cursor.value])
      if (row !== undefined) rows.push(row)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
  return args.direction === 'prev'
    ? eventsOf(
        [...rows].sort((a, b) => a.seq - b.seq),
        args.schema,
      )
    : eventsOf(rows, args.schema)
}

export function createIndexedDbSessionLog(args: {
  factory: IdbFactory | undefined
  keyRanges?: IdbKeyRangeFactory | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionLog {
  const { factory } = args
  const keyRanges = args.keyRanges ?? defaultKeyRangeFactory()
  const schema = args.eventSchema ?? v2EventSchema
  const sessionRange = (sessionId: string) =>
    keyRanges === undefined
      ? undefined
      : keyRanges.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])

  const withDatabase = async <T>({
    fallback,
    use,
  }: {
    fallback: T
    use: (db: IdbDatabase) => Promise<T>
  }): Promise<T> => {
    if (factory === undefined) return fallback
    const db = await openDatabase(factory).catch(() => undefined)
    if (db === undefined) return fallback
    try {
      return await use(db)
    } catch {
      return fallback
    } finally {
      db.close()
    }
  }

  const readRange = (params: {
    sessionId: string
    fromSeq: number
    toSeq: number
  }): Promise<readonly V2Event[]> =>
    withDatabase<readonly V2Event[]>({
      fallback: [],
      use: async (db) => {
        const tx = db.transaction(SESSION_LOG_EVENTS_STORE, 'readonly')
        const range =
          keyRanges === undefined
            ? undefined
            : keyRanges.bound([params.sessionId, params.fromSeq], [params.sessionId, params.toSeq])
        const rows = rowsOf(
          await requestDone(tx.objectStore(SESSION_LOG_EVENTS_STORE).getAll(range)),
        )
        return eventsOf(
          [...rows].sort((a, b) => a.seq - b.seq),
          schema,
        )
      },
    })

  return {
    appendPage: ({ sessionId, events, head }) =>
      withDatabase<void>({
        fallback: undefined,
        use: async (db) => {
          const tx = db.transaction(
            [SESSION_LOG_EVENTS_STORE, SESSION_LOG_SNAPSHOTS_STORE],
            'readwrite',
          )
          const done = transactionDone(tx)
          done.catch(() => undefined)
          const store = tx.objectStore(SESSION_LOG_EVENTS_STORE)
          for (const event of events) {
            store.put({ sessionId, seq: event.seq, event } satisfies LogRow)
          }
          const snapshots = tx.objectStore(SESSION_LOG_SNAPSHOTS_STORE)
          const existing = await requestDone(snapshots.get(sessionId))
          const held = existing === undefined ? undefined : (existing as SnapshotRow).snapshot
          snapshots.put({
            sessionId,
            snapshot: held,
            head,
          } satisfies SnapshotRow)
          await done
        },
      }),
    readRange,
    readTail: ({ sessionId, count }) =>
      withDatabase<readonly V2Event[]>({
        fallback: [],
        use: (db) =>
          readCursor({
            store: db
              .transaction(SESSION_LOG_EVENTS_STORE, 'readonly')
              .objectStore(SESSION_LOG_EVENTS_STORE),
            range: sessionRange(sessionId),
            count,
            direction: 'prev',
            schema,
          }),
      }),
    readBefore: ({ sessionId, seq, count }) =>
      withDatabase<readonly V2Event[]>({
        fallback: [],
        use: (db) =>
          readCursor({
            store: db
              .transaction(SESSION_LOG_EVENTS_STORE, 'readonly')
              .objectStore(SESSION_LOG_EVENTS_STORE),
            range:
              keyRanges === undefined
                ? undefined
                : keyRanges.bound([sessionId, 0], [sessionId, seq - 1]),
            count,
            direction: 'prev',
            schema,
          }),
      }),
    loadSnapshot: (sessionId) =>
      withDatabase<SessionLogSnapshot | undefined>({
        fallback: undefined,
        use: async (db) => {
          const tx = db.transaction(SESSION_LOG_SNAPSHOTS_STORE, 'readonly')
          const raw = await requestDone(tx.objectStore(SESSION_LOG_SNAPSHOTS_STORE).get(sessionId))
          const loaded = logSnapshotOf(raw)
          if (raw !== undefined && loaded === undefined) {
            const cleanup = db.transaction(SESSION_LOG_SNAPSHOTS_STORE, 'readwrite')
            cleanup.objectStore(SESSION_LOG_SNAPSHOTS_STORE).delete(sessionId)
          }
          return loaded
        },
      }),
    saveSnapshot: ({ sessionId, snapshot }) =>
      withDatabase<void>({
        fallback: undefined,
        use: async (db) => {
          const tx = db.transaction(SESSION_LOG_SNAPSHOTS_STORE, 'readwrite')
          const done = transactionDone(tx)
          done.catch(() => undefined)
          const store = tx.objectStore(SESSION_LOG_SNAPSHOTS_STORE)
          const existing = await requestDone(store.get(sessionId))
          const head = existing === undefined ? undefined : (existing as SnapshotRow).head
          store.put({ sessionId, snapshot, head } satisfies SnapshotRow)
          await done
        },
      }),
    deleteSession: (sessionId) =>
      withDatabase<void>({
        fallback: undefined,
        use: async (db) => {
          const tx = db.transaction(
            [SESSION_LOG_EVENTS_STORE, SESSION_LOG_SNAPSHOTS_STORE],
            'readwrite',
          )
          const done = transactionDone(tx)
          done.catch(() => undefined)
          tx.objectStore(SESSION_LOG_EVENTS_STORE).delete(sessionRange(sessionId))
          tx.objectStore(SESSION_LOG_SNAPSHOTS_STORE).delete(sessionId)
          await done
        },
      }),
    listSessions: () =>
      withDatabase<readonly string[]>({
        fallback: [],
        use: async (db) => {
          const tx = db.transaction(SESSION_LOG_SNAPSHOTS_STORE, 'readonly')
          const keys = await requestDone(tx.objectStore(SESSION_LOG_SNAPSHOTS_STORE).getAllKeys())
          return keys.filter((key): key is string => typeof key === 'string')
        },
      }),
    clear: () =>
      withDatabase<void>({
        fallback: undefined,
        use: async (db) => {
          const tx = db.transaction(
            [SESSION_LOG_EVENTS_STORE, SESSION_LOG_SNAPSHOTS_STORE],
            'readwrite',
          )
          const done = transactionDone(tx)
          done.catch(() => undefined)
          tx.objectStore(SESSION_LOG_EVENTS_STORE).clear()
          tx.objectStore(SESSION_LOG_SNAPSHOTS_STORE).clear()
          await done
        },
      }),
  }
}

export const browserSessionLog = (eventSchema?: z.ZodType<V2Event>): SessionLog =>
  createIndexedDbSessionLog({
    factory: defaultIndexedDbFactory(),
    eventSchema,
  })
