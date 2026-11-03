import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '../testing'

const NOW = new Date('2026-11-02T00:00:00.000Z')
const NUL_ESCAPE = String.raw`{"text":"a\u0000b","lone":"\ud800","pair":"\ud83d\ude00"}`

const sessionRow = () => ({
  id: 'ses_1',
  userId: 'user_1',
  projectId: 'project_1',
  title: null,
  mainThreadId: 'thr_1',
  nextInboxId: 1,
  createdAt: NOW,
})

describe('v2 namespace client', () => {
  const testDb = useTestDatabase()

  async function seedThread() {
    const { db } = testDb()
    await db.orm.v2.V2Session.create(sessionRow())
    await db.orm.v2.V2Thread.create({
      id: 'thr_1',
      sessionId: 'ses_1',
      headSeq: 0,
      headHash: 'genesis',
      visibility: '{"spans":[]}',
      createdAt: NOW,
    })
  }

  it('creates and reads a session through db.orm.v2', async () => {
    const { db } = testDb()
    await db.orm.v2.V2Session.create(sessionRow())
    expect(await db.orm.v2.V2Session.first({ id: 'ses_1' })).toEqual(sessionRow())
  })

  it('round-trips canonical text containing \\u0000 and lone surrogate escapes byte-identical', async () => {
    const { db, pool } = testDb()
    await seedThread()
    await db.orm.v2.V2Event.create({
      threadId: 'thr_1',
      seq: 1,
      id: 'evt_1',
      epoch: 1,
      type: 'message',
      runId: 'run_1',
      at: NOW,
      prevHash: 'genesis',
      hash: 'h1',
      canonical: NUL_ESCAPE,
    })
    const row = await db.orm.v2.V2Event.first({ id: 'evt_1' })
    expect(row?.canonical).toBe(NUL_ESCAPE)
    expect(row?.canonical.length).toBe(NUL_ESCAPE.length)
    const raw = await pool.query<{ canonical: string }>(
      'SELECT canonical FROM "v2"."V2Event" WHERE id = $1',
      ['evt_1'],
    )
    expect(raw.rows[0]?.canonical).toBe(NUL_ESCAPE)
  })

  it('truncateAll empties every v2 table', async () => {
    const { db, pool } = testDb()
    await seedThread()
    await db.orm.v2.V2InboxEntry.create({
      sessionId: 'ses_1',
      inboxId: 1,
      kind: 'user',
      payload: '{}',
      postedAt: NOW,
    })
    await db.orm.v2.V2Lease.create({
      sessionId: 'ses_1',
      epoch: 1,
      holderId: null,
      renewedAt: NOW,
      ttlMs: 1000,
      wantsHolder: false,
    })
    await db.orm.v2.V2Event.create({
      threadId: 'thr_1',
      seq: 1,
      id: 'evt_1',
      epoch: 1,
      type: 'message',
      runId: 'run_1',
      at: NOW,
      prevHash: 'genesis',
      hash: 'h1',
      canonical: '{}',
    })
    const { truncateAll } = await import('../testing')
    await truncateAll()
    for (const table of ['V2Session', 'V2Thread', 'V2Event', 'V2InboxEntry', 'V2Lease']) {
      const count = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "v2"."${table}"`)
      expect(count.rows[0]?.n).toBe('0')
    }
  })
})
