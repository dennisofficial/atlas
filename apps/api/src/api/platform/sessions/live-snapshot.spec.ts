import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, STAMP, USER_A } from '../../../../test/session-seed'
import { liveSnapshot } from './live-snapshot'
import { INACTIVE_AFTER_MS, SIDEBAR_BUCKET_LIMIT } from './sidebar-bucket'

const HOUR_MS = 60 * 60 * 1000

const archivedRowsOf = async (args: { now: number }) => {
  const snapshot = await liveSnapshot({ userId: USER_A, now: args.now })
  return {
    ...snapshot,
    archivedRows: snapshot.rows.filter((row) => row.thread.archivedAt !== null),
  }
}

describe('liveSnapshot', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('caps the inactive and archived rows at the sidebar limit and counts them all', async () => {
    const now = STAMP.getTime()
    for (let index = 0; index < 30; index += 1) {
      await seedThreadRow({
        id: `archived_${index}`,
        userId: USER_A,
        archivedAt: STAMP,
        title: `archived ${index}`,
        updatedAt: new Date(now - index * HOUR_MS),
      })
    }
    for (let index = 0; index < 26; index += 1) {
      await seedThreadRow({
        id: `inactive_${index}`,
        userId: USER_A,
        title: `inactive ${index}`,
        updatedAt: new Date(now - INACTIVE_AFTER_MS - (index + 1) * HOUR_MS),
      })
    }
    for (let index = 0; index < 3; index += 1) {
      await seedThreadRow({
        id: `active_${index}`,
        userId: USER_A,
        title: `active ${index}`,
        updatedAt: new Date(now - HOUR_MS),
      })
    }

    const { rows, counts, archivedRows } = await archivedRowsOf({ now })

    expect(archivedRows).toHaveLength(SIDEBAR_BUCKET_LIMIT)
    expect(
      rows.filter((row) => row.thread.archivedAt === null && row.thread.pinnedAt === null),
    ).toHaveLength(3 + SIDEBAR_BUCKET_LIMIT)
    expect(counts).toEqual({ active: 3, inactive: 26, archived: 30 })
  })

  it('buckets a pinned session as active and lets archived win over pinned', async () => {
    const now = STAMP.getTime()
    await seedThreadRow({
      id: 'pinned_old',
      userId: USER_A,
      pinnedAt: STAMP,
      updatedAt: new Date(now - INACTIVE_AFTER_MS - HOUR_MS),
    })
    await seedThreadRow({
      id: 'pinned_archived',
      userId: USER_A,
      pinnedAt: STAMP,
      archivedAt: STAMP,
      updatedAt: new Date(now - INACTIVE_AFTER_MS - HOUR_MS),
    })

    const { counts, rows } = await archivedRowsOf({ now })

    expect(counts).toEqual({ active: 1, inactive: 0, archived: 1 })
    expect(rows.map((row) => row.sessionId).sort()).toEqual([
      'ses_pinned_archived',
      'ses_pinned_old',
    ])
  })
})
