import { v2EventSchema, type V2Event } from '@dltech/atlas-core'
import {
  logSnapshotOf,
  SESSION_LOG_STRUCTURE_VERSION,
  type SessionLog,
  type SessionLogSnapshot,
} from '@dltech/atlas-client/stream'
import type { z } from 'zod'

import type { SqliteExecutor } from '../../storage/sqlite-executor'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_log_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  raw TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS session_log_snapshots (
  session_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  cursor TEXT NOT NULL,
  visibility TEXT NOT NULL,
  pending TEXT NOT NULL,
  view TEXT NOT NULL,
  failure_message TEXT NOT NULL,
  durable TEXT NOT NULL,
  command_log TEXT NOT NULL,
  through_seq INTEGER NOT NULL,
  head TEXT
);`

const parse = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const rowOf = (raw: unknown): Record<string, unknown> | undefined =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined

const eventsOf = (rows: readonly unknown[], schema: z.ZodType<V2Event>): readonly V2Event[] =>
  rows.flatMap((row) => {
    const parsed = schema.safeParse(parse(rowOf(row)?.raw))
    return parsed.success ? [parsed.data] : []
  })

const snapshotRowOf = (row: Record<string, unknown>): unknown => ({
  snapshot: {
    version: row.version,
    cursor: parse(row.cursor),
    visibility: parse(row.visibility),
    pending: parse(row.pending),
    view: parse(row.view),
    failureMessage: parse(row.failure_message),
    durable: parse(row.durable),
    commandLog: parse(row.command_log),
    throughSeq: row.through_seq,
  },
  head: parse(row.head),
})

export const createSqliteSessionLog = (args: {
  db: SqliteExecutor
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionLog & { prepare(): Promise<void> } => {
  const { db } = args
  const schema = args.eventSchema ?? v2EventSchema

  const prepare = async (): Promise<void> => {
    const [version] = await db.getAllAsync('PRAGMA user_version')
    if (Number(rowOf(version)?.user_version ?? 0) !== SESSION_LOG_STRUCTURE_VERSION) {
      await db.execAsync(
        'DROP TABLE IF EXISTS session_log_events; DROP TABLE IF EXISTS session_log_snapshots;',
      )
      await db.execAsync(`PRAGMA user_version = ${SESSION_LOG_STRUCTURE_VERSION}`)
    }
    await db.execAsync(SCHEMA)
  }

  const dropSession = async (sessionId: string): Promise<void> => {
    await db.runAsync('DELETE FROM session_log_events WHERE session_id = ?', sessionId)
    await db.runAsync('DELETE FROM session_log_snapshots WHERE session_id = ?', sessionId)
  }

  const readDescending = async (sql: string, params: readonly (string | number)[]) => {
    const rows = await db.getAllAsync(sql, ...params)
    return eventsOf([...rows].reverse(), schema)
  }

  return {
    prepare,
    appendPage: ({ sessionId, events, head }) =>
      db.withTransactionAsync(async () => {
        for (const event of events) {
          await db.runAsync(
            'INSERT OR REPLACE INTO session_log_events (session_id, seq, raw) VALUES (?, ?, ?)',
            sessionId,
            event.seq,
            JSON.stringify(event),
          )
        }
        await db.runAsync(
          `INSERT INTO session_log_snapshots (session_id, version, cursor, visibility, pending, view, failure_message, durable, command_log, through_seq, head)
           VALUES (?, 0, 'null', '{}', '{}', '{}', '{}', '[]', '[]', 0, ?)
           ON CONFLICT(session_id) DO UPDATE SET head = excluded.head`,
          sessionId,
          JSON.stringify(head),
        )
      }),
    readRange: async ({ sessionId, fromSeq, toSeq }) => {
      const rows = await db.getAllAsync(
        'SELECT raw FROM session_log_events WHERE session_id = ? AND seq BETWEEN ? AND ? ORDER BY seq',
        sessionId,
        fromSeq,
        toSeq,
      )
      return eventsOf(rows, schema)
    },
    readTail: ({ sessionId, count }) =>
      readDescending(
        'SELECT raw FROM session_log_events WHERE session_id = ? ORDER BY seq DESC LIMIT ?',
        [sessionId, count],
      ),
    readBefore: ({ sessionId, seq, count }) =>
      readDescending(
        'SELECT raw FROM session_log_events WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
        [sessionId, seq, count],
      ),
    loadSnapshot: async (sessionId) => {
      const [row] = await db.getAllAsync(
        'SELECT * FROM session_log_snapshots WHERE session_id = ?',
        sessionId,
      )
      const found = rowOf(row)
      if (found === undefined) return undefined
      const loaded = logSnapshotOf(snapshotRowOf(found))
      if (loaded === undefined) await dropSession(sessionId)
      return loaded
    },
    saveSnapshot: ({ sessionId, snapshot }) =>
      db.runAsync(
        `INSERT INTO session_log_snapshots (session_id, version, cursor, visibility, pending, view, failure_message, durable, command_log, through_seq, head)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(session_id) DO UPDATE SET
           version = excluded.version,
           cursor = excluded.cursor,
           visibility = excluded.visibility,
           pending = excluded.pending,
           view = excluded.view,
           failure_message = excluded.failure_message,
           durable = excluded.durable,
           command_log = excluded.command_log,
           through_seq = excluded.through_seq`,
        sessionId,
        snapshot.version,
        JSON.stringify(snapshot.cursor ?? null),
        JSON.stringify(snapshot.visibility),
        JSON.stringify(snapshot.pending),
        JSON.stringify(snapshot.view),
        JSON.stringify(snapshot.failureMessage),
        JSON.stringify(snapshot.durable),
        JSON.stringify(snapshot.commandLog),
        snapshot.throughSeq,
      ),
    deleteSession: dropSession,
    listSessions: async () => {
      const rows = await db.getAllAsync('SELECT session_id FROM session_log_snapshots')
      return rows.flatMap((row) => {
        const sessionId = rowOf(row)?.session_id
        return typeof sessionId === 'string' ? [sessionId] : []
      })
    },
    clear: async () => {
      await db.execAsync('DELETE FROM session_log_events; DELETE FROM session_log_snapshots;')
    },
  }
}

export type { SessionLogSnapshot }
