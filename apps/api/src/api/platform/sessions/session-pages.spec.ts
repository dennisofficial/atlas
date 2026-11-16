import { ESessionBucket } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, STAMP, USER_A } from '../../../../test/session-seed'
import { pageSessions } from './session-pages'

const SECOND_MS = 1_000

describe('pageSessions', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    for (let index = 0; index < 3; index += 1) {
      await seedThreadRow({
        id: `kept_${index}`,
        userId: USER_A,
        archivedAt: STAMP,
        updatedAt: new Date(STAMP.getTime() - index * SECOND_MS),
      })
    }
    await seedThreadRow({
      id: 'gone',
      userId: USER_A,
      archivedAt: STAMP,
      deletedAt: STAMP,
      title: 'gone',
    })
  })

  it('pages the live sessions only and counts them without the deleted one', async () => {
    const page = await pageSessions({ userId: USER_A, bucket: ESessionBucket.Archived, limit: 2 })

    expect(page.rows.map((row) => row.thread.id)).toEqual(['kept_0', 'kept_1'])
    expect(page.counts).toEqual({ active: 0, inactive: 0, archived: 3 })
    expect(page.next).toBeDefined()
  })

  it('never pages a soft-deleted session', async () => {
    const page = await pageSessions({ userId: USER_A, bucket: ESessionBucket.Archived, limit: 10 })

    expect(page.rows.map((row) => row.thread.id)).toEqual(['kept_0', 'kept_1', 'kept_2'])
    expect(page.next).toBeUndefined()
  })

  it('finds no session by the title of a soft-deleted one', async () => {
    const page = await pageSessions({
      userId: USER_A,
      bucket: ESessionBucket.Archived,
      search: 'gone',
    })

    expect(page.rows).toEqual([])
    expect(page.counts).toEqual({ active: 0, inactive: 0, archived: 0 })
  })
})
