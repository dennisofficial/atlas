import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import {
  EMPTY_PENDING,
  EMPTY_VISIBILITY,
  initialFailureMessage,
  initialSessionViewState,
} from '@dltech/atlas-core'
import { SESSION_LOG_STRUCTURE_VERSION, type SessionLogSnapshot } from '@dltech/atlas-client/stream'
import { headOf, mintEvents, userSaid } from '@dltech/atlas-client/stream-fixture'

import type { SqlValue, SqliteExecutor } from '../../../storage/sqlite-executor'
import { createSqliteSessionLog } from '../session-log-store'

const executorOf = (): SqliteExecutor => {
  const db = new Database(':memory:')
  return {
    execAsync: async (sql) => {
      db.exec(sql)
    },
    runAsync: async (sql, ...params) => {
      db.query(sql).run(...(params as SqlValue[]))
    },
    getAllAsync: async (sql, ...params) => db.query(sql).all(...(params as SqlValue[])),
    withTransactionAsync: async (run) => {
      db.exec('BEGIN')
      try {
        await run()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

const setup = async () => {
  const db = executorOf()
  const log = createSqliteSessionLog({ db })
  await log.prepare()
  return { log }
}

const snapshotAt = (args: { throughSeq: number; cursorSeq?: number }): SessionLogSnapshot => ({
  version: SESSION_LOG_STRUCTURE_VERSION,
  cursor: { seq: args.cursorSeq ?? args.throughSeq, hash: 'h' },
  visibility: EMPTY_VISIBILITY,
  pending: EMPTY_PENDING,
  view: initialSessionViewState,
  failureMessage: initialFailureMessage,
  durable: [],
  commandLog: [],
  throughSeq: args.throughSeq,
})

describe('the sqlite session log', () => {
  it('stores events one row per seq and reads ranges', async () => {
    const { log } = await setup()
    const events = mintEvents({ bodies: [userSaid('a'), userSaid('b'), userSaid('c')] })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })

    expect(
      (await log.readRange({ sessionId: 's1', fromSeq: 2, toSeq: 3 })).map((e) => e.seq),
    ).toEqual([2, 3])
    expect((await log.readTail({ sessionId: 's1', count: 2 })).map((e) => e.seq)).toEqual([2, 3])
    expect((await log.readBefore({ sessionId: 's1', seq: 3, count: 5 })).map((e) => e.seq)).toEqual(
      [1, 2],
    )
  })

  it('round-trips a snapshot and resumes at the appended head', async () => {
    const { log } = await setup()
    const events = mintEvents({ bodies: [userSaid('a'), userSaid('b')] })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })
    await log.saveSnapshot({ sessionId: 's1', snapshot: snapshotAt({ throughSeq: 1 }) })

    expect(await log.loadSnapshot('s1')).toEqual({
      ...snapshotAt({ throughSeq: 1 }),
      cursor: { seq: 2, hash: headOf(events).hash },
    })
  })

  it('forgets a session of another structure version', async () => {
    const { log } = await setup()
    const events = mintEvents({ bodies: [userSaid('a')] })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })
    await log.saveSnapshot({
      sessionId: 's1',
      snapshot: { ...snapshotAt({ throughSeq: 1 }), version: 1 },
    })

    expect(await log.loadSnapshot('s1')).toBeUndefined()
    expect(await log.listSessions()).toEqual([])
  })

  it('lists each session once and deletes only the one asked for', async () => {
    const { log } = await setup()
    const events = mintEvents({ bodies: [userSaid('a')] })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })
    await log.appendPage({ sessionId: 's2', events, head: headOf(events) })
    await log.saveSnapshot({ sessionId: 's2', snapshot: snapshotAt({ throughSeq: 1 }) })

    expect([...(await log.listSessions())].sort()).toEqual(['s1', 's2'])

    await log.deleteSession('s1')
    expect(await log.readTail({ sessionId: 's1', count: 10 })).toEqual([])
    expect(await log.loadSnapshot('s2')).not.toBeUndefined()

    await log.clear()
    expect(await log.listSessions()).toEqual([])
  })
})
