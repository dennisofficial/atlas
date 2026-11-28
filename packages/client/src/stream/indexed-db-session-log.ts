import { recordEventSchema, type RecordEvent } from '@dltech/atlas-core'
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
import { type SessionLog, type SessionLogSnapshot } from './session-log'
import {
  createSessionLogDatabase,
  SESSION_LOG_EVENTS_STORE,
  SESSION_LOG_SNAPSHOTS_STORE,
} from './indexed-db-connection'

export {
  SESSION_LOG_DB,
  SESSION_LOG_EVENTS_STORE,
  SESSION_LOG_SNAPSHOTS_STORE,
  SESSION_LOG_LEGACY_STORES,
} from './indexed-db-connection'

type LogRow = { sessionId: string; seq: number; event: RecordEvent }

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

const eventsOf = (
  rows: readonly LogRow[],
  schema: z.ZodType<RecordEvent>,
): readonly RecordEvent[] =>
  rows.flatMap((row) => (schema.safeParse(row.event).success ? [row.event] : []))

const readCursor = async (args: {
  store: IdbObjectStore
  range: unknown
  count: number
  direction: 'next' | 'prev'
  schema: z.ZodType<RecordEvent>
}): Promise<readonly RecordEvent[]> => {
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
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): SessionLog {
  const { factory } = args
  const keyRanges = args.keyRanges ?? defaultKeyRangeFactory()
  const schema = args.eventSchema ?? recordEventSchema
  const sessionRange = (sessionId: string) =>
    keyRanges === undefined
      ? undefined
      : keyRanges.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])

  const database = factory === undefined ? undefined : createSessionLogDatabase(factory)

  const withDatabase = async <T>({
    fallback,
    use,
  }: {
    fallback: T
    use: (db: IdbDatabase) => Promise<T>
  }): Promise<T> => {
    if (database === undefined) return fallback
    return use(await database())
  }

  const readRange = (params: {
    sessionId: string
    fromSeq: number
    toSeq: number
  }): Promise<readonly RecordEvent[]> =>
    withDatabase<readonly RecordEvent[]>({
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
      withDatabase<readonly RecordEvent[]>({
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
      withDatabase<readonly RecordEvent[]>({
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
          const headOnly =
            typeof raw === 'object' &&
            raw !== null &&
            'snapshot' in raw &&
            raw.snapshot === undefined
          if (raw !== undefined && !headOnly && loaded === undefined) {
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

export const browserSessionLog = (eventSchema?: z.ZodType<RecordEvent>): SessionLog =>
  createIndexedDbSessionLog({
    factory: defaultIndexedDbFactory(),
    eventSchema,
  })
