import { describe, expect, it } from 'bun:test'
import { canonicalJson, chainHash } from '@dltech/atlas-core'
import { countQueries, useTestDatabase } from '@dltech/atlas-db/testing'

import { PostgresControlStore } from '../src/postgres'
import {
  appendBodies,
  makeHarness,
  said,
  seedGranted,
  THREAD,
} from '../src/testing/conformance/support'

const testDb = useTestDatabase()

const worldOf = async () => {
  const store = new PostgresControlStore(testDb().db)
  const harness = makeHarness(store)
  const epoch = await seedGranted(harness)
  const { events } = await appendBodies({
    harness,
    epoch,
    bodies: [said('漢😀'.repeat(4_000)), said('short'), said('last')],
  })
  return { store, events, plane: harness.plane }
}

describe('Postgres event page reads', () => {
  it('selects only seq and hash for a cursor in one query', async () => {
    const { plane, events } = await worldOf()
    const counter = countQueries()
    const cursor = await plane.readEventCursor({ threadId: THREAD, seq: 1 })
    const statements = counter.stop().filter((sql) => sql.toLowerCase().includes('select'))
    expect(cursor).toEqual({ seq: 1, hash: chainHash(events[0]!) })
    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('"hash"')
    expect(statements[0]).not.toContain('canonical')
  })

  it('returns only the bounded prefix from one SQL statement and reports truncation', async () => {
    const { store, events } = await worldOf()
    const counter = countQueries()
    const page = await store.transact(async (tx) => {
      if (tx.readEventsByBytes === undefined) throw new Error('missing byte-prefix reader')
      return tx.readEventsByBytes({
        threadId: THREAD,
        afterSeq: 0,
        throughSeq: 3,
        limit: 3,
        maxBytes: Buffer.byteLength(canonicalJson(events[0])),
      })
    })
    const statements = counter.stop().filter((sql) => sql.includes('"Event"'))
    expect(statements).toHaveLength(1)
    expect(page.rows.map((row) => row.seq)).toEqual([1])
    expect(page.stoppedEarly).toBe(true)
    expect(page.rows[0]?.hash).toBe(chainHash(events[0]!))
  })

  it('applies the type and row limits before the byte bound', async () => {
    const { store } = await worldOf()
    const page = await store.transact(async (tx) => {
      if (tx.readEventsByBytes === undefined) throw new Error('missing byte-prefix reader')
      return tx.readEventsByBytes({
        threadId: THREAD,
        afterSeq: 1,
        throughSeq: 3,
        onlyTypes: ['user-said'],
        limit: 1,
        maxBytes: 100_000,
      })
    })
    expect(page.rows.map((row) => row.seq)).toEqual([2])
    expect(page.stoppedEarly).toBe(false)
    const empty = await store.transact(async (tx) => {
      if (tx.readEventsByBytes === undefined) throw new Error('missing byte-prefix reader')
      return tx.readEventsByBytes({
        threadId: THREAD,
        afterSeq: 0,
        throughSeq: 3,
        onlyTypes: [],
        limit: 3,
        maxBytes: 1,
      })
    })
    expect(empty).toEqual({ rows: [], stoppedEarly: false })
  })
})
