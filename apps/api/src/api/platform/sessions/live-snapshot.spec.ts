import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, STAMP, USER_A } from '../../../../test/session-seed'
import { liveSnapshot } from './live-snapshot'
import { SIDEBAR_BUCKET_LIMIT } from './sidebar-bucket'

const HOUR_MS = 60 * 60 * 1000
const STALE_MS = 73 * HOUR_MS

describe('liveSnapshot', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('sends every unarchived row and caps the archived rows at the sidebar limit', async () => {
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
        id: `stale_${index}`,
        userId: USER_A,
        title: `stale ${index}`,
        updatedAt: new Date(now - STALE_MS - (index + 1) * HOUR_MS),
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

    const snapshot = await liveSnapshot({ userId: USER_A })
    const unarchived = snapshot.rows.filter((row) => row.thread.archivedAt === null)

    expect(snapshot.rows.filter((row) => row.thread.archivedAt !== null)).toHaveLength(
      SIDEBAR_BUCKET_LIMIT,
    )
    expect(unarchived).toHaveLength(26 + 3)
    expect(snapshot.counts).toEqual({ active: 29, archived: 30 })
  })

  it('keeps a pinned session with the active rows and lets archived win over pinned', async () => {
    const now = STAMP.getTime()
    await seedThreadRow({
      id: 'pinned_old',
      userId: USER_A,
      pinnedAt: STAMP,
      updatedAt: new Date(now - STALE_MS - HOUR_MS),
    })
    await seedThreadRow({
      id: 'pinned_archived',
      userId: USER_A,
      pinnedAt: STAMP,
      archivedAt: STAMP,
      updatedAt: new Date(now - STALE_MS - HOUR_MS),
    })

    const snapshot = await liveSnapshot({ userId: USER_A })

    expect(snapshot.counts).toEqual({ active: 1, archived: 1 })
    expect(snapshot.rows.map((row) => row.sessionId).sort()).toEqual([
      'ses_pinned_archived',
      'ses_pinned_old',
    ])
  })

  it('drops soft-deleted sessions from the rows and the counts', async () => {
    const now = STAMP.getTime()
    await seedThreadRow({ id: 'kept_active', userId: USER_A, updatedAt: new Date(now - HOUR_MS) })
    await seedThreadRow({
      id: 'deleted_active',
      userId: USER_A,
      deletedAt: STAMP,
      updatedAt: new Date(now - HOUR_MS),
    })

    const snapshot = await liveSnapshot({ userId: USER_A })

    expect(snapshot.rows.map((row) => row.sessionId)).toEqual(['ses_kept_active'])
    expect(snapshot.counts).toEqual({ active: 1, archived: 0 })
  })
})
