import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import {
  recordApiBootStep,
  seedArchivedApiSession,
  seedSweepSandboxRow,
  recordingSweepDeps,
} from './archived-sandbox-sweep.fixture'
import {
  ARCHIVED_SANDBOX_GRACE_MS,
  sweepArchivedSandboxes,
  type ArchivedSandboxSweepDeps,
} from './archived-sandbox-sweep'

const NOW = new Date('2026-11-02T06:23:00.000Z')

const DAY_MS = 24 * 60 * 60 * 1_000
const EIGHT_DAYS_AGO = new Date(NOW.getTime() - 8 * DAY_MS)
const SIX_DAYS_AGO = new Date(NOW.getTime() - 6 * DAY_MS)

const sandboxRows = () => db.orm.public.CloudSandbox.all()

describe('sweepArchivedSandboxes', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1')
  })

  it('deletes the pod of an API-provisioned session archived beyond the grace', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO })
    const { deps, deleted, announced } = recordingSweepDeps()

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 1, deleted: 1, skipped: 0, failed: 0 })
    expect(deleted).toEqual([{ threadId: 'thr-1', name: 'atlas-thread-thr-1' }])
    expect(await sandboxRows()).toHaveLength(0)
    expect(announced).toEqual(['thr-1'])
  })

  it('leaves a session archived within the grace untouched', async () => {
    await seedArchivedApiSession({ archivedAt: SIX_DAYS_AGO })
    const { deps, deleted, announced } = recordingSweepDeps()

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 0, deleted: 0, skipped: 0, failed: 0 })
    expect(deleted).toHaveLength(0)
    expect(await sandboxRows()).toHaveLength(1)
    expect(announced).toHaveLength(0)
  })

  it('never touches an unarchived session', async () => {
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
    await seedSweepSandboxRow({ threadId: 'thr-1' })
    await recordApiBootStep({ threadId: 'thr-1' })
    const { deps, deleted } = recordingSweepDeps()

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 0, deleted: 0, skipped: 0, failed: 0 })
    expect(deleted).toHaveLength(0)
    expect(await sandboxRows()).toHaveLength(1)
  })

  it('skips a TUI BYO row with no boot steps', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO, withBootSteps: false })
    const { deps, deleted } = recordingSweepDeps()

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 1, deleted: 0, skipped: 1, failed: 0 })
    expect(deleted).toHaveLength(0)
    expect(await sandboxRows()).toHaveLength(1)
  })

  it('skips a thread whose pod is a local lease', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO, withLease: true })
    const { deps, deleted } = recordingSweepDeps()

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 1, deleted: 0, skipped: 1, failed: 0 })
    expect(deleted).toHaveLength(0)
    expect(await sandboxRows()).toHaveLength(1)
  })

  it('skips a pod an unarchived teammate session still uses', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO })
    await seedThreadRow({ id: 'thr-mate', userId: 'usr-1' })
    await db.orm.public.Session.where({ id: 'ses_thr-mate' }).update({
      managedBySessionId: 'ses_thr-1',
    })
    const { deps, deleted } = recordingSweepDeps()

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 1, deleted: 0, skipped: 1, failed: 0 })
    expect(deleted).toHaveLength(0)
    expect(await sandboxRows()).toHaveLength(1)
  })

  it('still deletes when every teammate is itself archived', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO })
    await seedThreadRow({ id: 'thr-mate', userId: 'usr-1', archivedAt: EIGHT_DAYS_AGO })
    await db.orm.public.Session.where({ id: 'ses_thr-mate' }).update({
      managedBySessionId: 'ses_thr-1',
    })
    const { deps, deleted } = recordingSweepDeps()

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 1, deleted: 1, skipped: 0, failed: 0 })
    expect(deleted).toEqual([{ threadId: 'thr-1', name: 'atlas-thread-thr-1' }])
    expect(await sandboxRows()).toHaveLength(0)
  })

  it('never selects the archived teammate session itself', async () => {
    await seedThreadRow({ id: 'thr-manager', userId: 'usr-1' })
    await seedArchivedApiSession({ threadId: 'thr-mate', archivedAt: EIGHT_DAYS_AGO })
    await db.orm.public.Session.where({ id: 'ses_thr-mate' }).update({
      managedBySessionId: 'ses_thr-manager',
    })

    const summary = await sweepArchivedSandboxes({ now: NOW, deps: recordingSweepDeps().deps })

    expect(summary.scanned).toBe(0)
    expect(await sandboxRows()).toHaveLength(1)
  })

  it('counts a failed delete, keeps the row, and clears the claim so the next run retries', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO })
    const { deps, deleted, announced, logged } = recordingSweepDeps({
      deleteFails: new Error('vercel is down'),
    })

    const summary = await sweepArchivedSandboxes({ now: NOW, deps })

    expect(summary).toEqual({ scanned: 1, deleted: 0, skipped: 0, failed: 1 })
    expect(deleted).toHaveLength(0)
    expect(announced).toHaveLength(0)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('thr-1')
    const [row] = await sandboxRows()
    expect(row).toBeDefined()
    expect(row?.wakeClaim).toBeNull()

    const retry = await sweepArchivedSandboxes({ now: NOW, deps: recordingSweepDeps().deps })
    expect(retry).toEqual({ scanned: 1, deleted: 1, skipped: 0, failed: 0 })
    expect(await sandboxRows()).toHaveLength(0)
  })

  it('skips a session unarchived between the select and its delete', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO })
    await seedArchivedApiSession({ threadId: 'thr-2', archivedAt: EIGHT_DAYS_AGO })
    const { deps, deleted } = recordingSweepDeps()
    const reactivating: ArchivedSandboxSweepDeps = {
      ...deps,
      deleteSandbox: async (deleteArgs) => {
        const other = deleteArgs.threadId === 'thr-1' ? 'ses_thr-2' : 'ses_thr-1'
        await db.orm.public.Session.where({ id: other }).update({ archivedAt: null })
        await deps.deleteSandbox(deleteArgs)
      },
    }

    const summary = await sweepArchivedSandboxes({ now: NOW, deps: reactivating })

    expect(summary).toEqual({ scanned: 2, deleted: 1, skipped: 1, failed: 0 })
    expect(deleted).toHaveLength(1)
    const remaining = await sandboxRows()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.wakeClaim).toBeNull()
    const survivor = await db.orm.public.Session.first({ id: remaining[0]?.sessionId ?? '' })
    expect(survivor?.archivedAt).toBeNull()
  })

  it('keeps the grace boundary strict', async () => {
    await seedArchivedApiSession({
      archivedAt: new Date(NOW.getTime() - ARCHIVED_SANDBOX_GRACE_MS + 1),
    })

    const summary = await sweepArchivedSandboxes({ now: NOW, deps: recordingSweepDeps().deps })

    expect(summary.scanned).toBe(0)
    expect(await sandboxRows()).toHaveLength(1)
  })
})
