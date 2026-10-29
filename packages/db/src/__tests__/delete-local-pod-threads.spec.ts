import { describe, expect, it } from 'bun:test'
import { deleteLocalPodThreads } from '../../migrations/app/20261029T0309_drop_local_pod_threads/data-steps'
import { seedThread, seedUser, useTestDatabase } from '../testing'

describe('drop_local_pod_threads data step', () => {
  const testDb = useTestDatabase()

  it('removes leased threads and their sub-agents, and keeps every other thread', async () => {
    const { db, pool } = testDb()
    await seedUser({ db, id: 'usr-1' })
    await seedThread({ db, id: 'local', userId: 'usr-1' })
    await seedThread({ db, id: 'cloud', userId: 'usr-1' })
    await db.orm.public.Thread.create({
      id: 'local-child',
      userId: 'usr-1',
      spawnerThreadId: 'local',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.orm.public.LocalPodLease.create({ userId: 'usr-1', threadId: 'local', tokenHash: 'h' })

    for (const step of deleteLocalPodThreads.execute) await pool.query(step.sql)

    const ids = await db.orm.public.Thread.select('id').all()
    expect(ids).toEqual([{ id: 'cloud' }])
  })
})
