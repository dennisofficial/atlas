import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { EThreadArchiveCleanupOutcome } from './thread-archive-cleanup.contract'
import { ARCHIVE_PARK_REASON, runThreadArchiveCleanup } from './thread-archive-cleanup-run'

const ARCHIVED_AT = new Date('2026-10-01T12:00:00.000Z')
const payload = { threadId: 'thr_1', archivedAt: ARCHIVED_AT.toISOString() }

describe('runThreadArchiveCleanup', () => {
  useTestDatabase()
  const park = vi.fn(async () => undefined)
  const teardownPreviews = vi.fn(async () => undefined)
  const deps = { park, teardownPreviews }

  beforeEach(async () => {
    park.mockClear()
    teardownPreviews.mockClear()
    await seedUsers(USER_A)
  })

  it('is superseded when the thread is gone', async () => {
    const result = await runThreadArchiveCleanup({ payload, deps })

    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.Superseded)
    expect(teardownPreviews).not.toHaveBeenCalled()
    expect(park).not.toHaveBeenCalled()
  })

  it('is superseded when the thread was unarchived', async () => {
    await seedSandboxRow({ threadId: 'thr_1' })

    const result = await runThreadArchiveCleanup({ payload, deps })

    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.Superseded)
    expect(park).not.toHaveBeenCalled()
  })

  it('is superseded when the thread was archived again later', async () => {
    await seedSandboxRow({ threadId: 'thr_1' })
    await db.orm.public.Thread.where({ id: 'thr_1' }).update({
      archivedAt: new Date('2026-10-02T12:00:00.000Z'),
    })

    const result = await runThreadArchiveCleanup({ payload, deps })

    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.Superseded)
    expect(park).not.toHaveBeenCalled()
  })

  it('reports no sandbox when the thread has no row', async () => {
    await seedThreadRow({ id: 'thr_1', archivedAt: ARCHIVED_AT })

    const result = await runThreadArchiveCleanup({ payload, deps })

    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.NoSandbox)
    expect(teardownPreviews).toHaveBeenCalledWith({ threadId: 'thr_1' })
    expect(park).not.toHaveBeenCalled()
  })

  it('parks a running sandbox once with the archive reason', async () => {
    await seedThreadRow({ id: 'thr_1', archivedAt: ARCHIVED_AT })
    const row = await seedSandboxRow({ threadId: 'thr_1', state: 'running' })

    const result = await runThreadArchiveCleanup({ payload, deps })

    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.Parked)
    expect(park).toHaveBeenCalledTimes(1)
    expect(park).toHaveBeenCalledWith({
      row: expect.objectContaining({ threadId: 'thr_1', name: row.name }),
      reason: ARCHIVE_PARK_REASON,
    })
  })

  it('leaves an already parked sandbox alone', async () => {
    await seedThreadRow({ id: 'thr_1', archivedAt: ARCHIVED_AT })
    await seedSandboxRow({ threadId: 'thr_1', state: 'parked' })

    const result = await runThreadArchiveCleanup({ payload, deps })

    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.AlreadyParked)
    expect(park).not.toHaveBeenCalled()
  })

  it('still parks the sandbox when preview teardown fails, then rethrows', async () => {
    await seedThreadRow({ id: 'thr_1', archivedAt: ARCHIVED_AT })
    await seedSandboxRow({ threadId: 'thr_1', state: 'running' })
    teardownPreviews.mockRejectedValueOnce(new Error('cloudflare down'))

    await expect(runThreadArchiveCleanup({ payload, deps })).rejects.toThrow('cloudflare down')

    expect(park).toHaveBeenCalledTimes(1)
  })
})
