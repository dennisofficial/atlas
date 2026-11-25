import { describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

const NOW = new Date('2026-11-19T00:00:00.000Z')

describe('V2Event append-only trigger', () => {
  const testDb = useTestDatabase()

  async function seedEvent() {
    const { db } = testDb()
    await db.orm.public.Session.create({
      id: 'ses_1',
      userId: 'user_1',
      mainThreadId: 'thr_1',
      nextInboxId: 1,
      createdAt: NOW,
      modelRef: 'anthropic/claude-haiku-4-5',
      modelEffort: 'medium',
      modelFast: false,
    })
    await db.orm.public.Thread.create({
      id: 'thr_1',
      sessionId: 'ses_1',
      headSeq: 1,
      headHash: 'h1',
      visibility: '{"spans":[]}',
      createdAt: NOW,
    })
    await db.orm.public.Event.create({
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
  }

  it('rejects UPDATE of an appended row', async () => {
    const { pool } = testDb()
    await seedEvent()
    await expect(
      pool.query('UPDATE "public"."Event" SET canonical = $1 WHERE id = $2', [
        '{"rewritten":1}',
        'evt_1',
      ]),
    ).rejects.toThrow(/Event is append-only/)
  })

  it('rejects DELETE of an appended row', async () => {
    const { pool } = testDb()
    await seedEvent()
    await expect(
      pool.query('DELETE FROM "public"."Event" WHERE id = $1', ['evt_1']),
    ).rejects.toThrow(/Event is append-only/)
    const kept = await pool.query<{ n: string }>('SELECT count(*) AS n FROM "public"."Event"')
    expect(kept.rows[0]?.n).toBe('1')
  })

  it('still appends new rows', async () => {
    const { db, pool } = testDb()
    await seedEvent()
    await db.orm.public.Event.create({
      threadId: 'thr_1',
      seq: 2,
      id: 'evt_2',
      epoch: 1,
      type: 'message',
      runId: 'run_1',
      at: NOW,
      prevHash: 'h1',
      hash: 'h2',
      canonical: '{}',
    })
    const count = await pool.query<{ n: string }>('SELECT count(*) AS n FROM "public"."Event"')
    expect(count.rows[0]?.n).toBe('2')
  })
})
