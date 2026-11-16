import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, STAMP, USER_A } from '../../../../test/session-seed'
import { listMainThreads } from './main-thread-listing'

const REPO = 'dennisofficial/atlas'

describe('listMainThreads', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'thr-kept', userId: USER_A, repo: REPO, updatedAt: STAMP })
    await seedThreadRow({
      id: 'thr-gone',
      userId: USER_A,
      repo: REPO,
      deletedAt: STAMP,
      updatedAt: new Date(STAMP.getTime() + 1_000),
    })
  })

  it('lists the live sessions of a project and not the soft-deleted ones', async () => {
    const rows = await listMainThreads({ userId: USER_A, scope: { project: REPO }, limit: 10 })

    expect(rows.map((row) => row.thread.id)).toEqual(['thr-kept'])
  })
})
