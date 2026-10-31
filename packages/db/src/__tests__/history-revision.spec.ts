import { describe, expect, it } from 'bun:test'
import { seedThread, seedUser, useTestDatabase } from '../testing'

describe('Thread history revision contract', () => {
  const testDb = useTestDatabase()

  it('migrates a non-null integer epoch default independently of metadata revision', async () => {
    const { db, pool } = testDb()
    await seedUser({ db, id: 'usr_history' })
    const thread = await seedThread({ db, id: 'thr_history', userId: 'usr_history' })
    expect(thread).toMatchObject({ historyRev: 0, rev: 0 })
    const column = await pool.query<{
      data_type: string
      is_nullable: string
      column_default: string
    }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'Thread' AND column_name = 'historyRev'`,
    )
    expect(column.rows).toEqual([{ data_type: 'integer', is_nullable: 'NO', column_default: '0' }])
    await db.orm.public.Thread.where({ id: thread.id }).update({ rev: 17, head: 8 })
    expect(await db.orm.public.Thread.first({ id: thread.id })).toMatchObject({ historyRev: 0 })
  })
})
