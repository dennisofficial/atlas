import { describe, expect, it } from 'bun:test'
import { seedThread, seedUser, useTestDatabase } from '../testing'

describe('Thread.waitingForModel migration', () => {
  const testDb = useTestDatabase()

  it('adds a nullable text column that defaults to null and round-trips a snapshot', async () => {
    const { db, pool } = testDb()
    await seedUser({ db, id: 'usr_waiting' })
    const thread = await seedThread({ db, id: 'thr_waiting', userId: 'usr_waiting' })
    const column = await pool.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'Thread' AND column_name = 'waitingForModel'`,
    )
    expect(column.rows).toEqual([{ data_type: 'text', is_nullable: 'YES' }])
    expect(thread.waitingForModel).toBeNull()
    await db.orm.public.Thread.where({ id: thread.id }).update({ waitingForModel: '{"k":1}' })
    expect(await db.orm.public.Thread.first({ id: thread.id })).toMatchObject({
      waitingForModel: '{"k":1}',
    })
  })
})
