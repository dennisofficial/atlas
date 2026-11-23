import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import type { GithubLegacyEffects } from './github-legacy-effects'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'

const AT = new Date('2026-11-18T10:00:00Z')

const rowOf = (args: { kind: string; payload: unknown }) => ({
  id: `out_${randomUUID()}`,
  kind: args.kind,
  repoFullName: 'compai/app',
  prNumber: 42,
  payload: args.payload as { threadId: string },
  dedupeKey: `${args.kind}:${randomUUID()}`,
  createdAt: AT,
  dispatchedAt: null,
  attempts: 0,
  lastError: null,
})

const seedRows = async () => ({
  signal: await db.orm.public.GithubPrOutbox.create(
    rowOf({ kind: 'thread-signal', payload: { threadId: 'thr_1' } }),
  ),
  wake: await db.orm.public.GithubPrOutbox.create(
    rowOf({
      kind: 'wake',
      payload: { notice: { userId: 'usr-a', repoFullName: 'compai/app', prNumber: 42 } },
    }),
  ),
  reconcile: await db.orm.public.GithubPrOutbox.create(
    rowOf({ kind: 'reconcile-checks', payload: { repoFullName: 'compai/app', headSha: 'abc' } }),
  ),
})

const dispatchedOf = async (id: string) =>
  (await db.orm.public.GithubPrOutbox.where({ id }).first())?.dispatchedAt ?? null

function rig(args: { legacy?: GithubLegacyEffects }) {
  const reconcile = vi.fn(async () => undefined)
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push: vi.fn(), pushEvent: vi.fn() },
    ...(args.legacy === undefined ? {} : { legacy: args.legacy }),
    reconcile,
    mergeability: async () => undefined,
    logger: { warn: () => undefined },
    now: () => AT,
  })

  return { dispatcher, reconcile }
}

const recordingLegacy = () => {
  const legacy = { threadChanged: vi.fn(), notifyEvent: vi.fn(async () => undefined) }
  return legacy
}

describe('GithubPrOutboxDispatcher v1 effect scope', () => {
  useTestDatabase()

  it('leaves the v1 rows for another dispatcher when it has no legacy port', async () => {
    const rows = await seedRows()
    const { dispatcher, reconcile } = rig({})

    expect(await dispatcher.drain()).toBe(1)

    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(await dispatchedOf(rows.reconcile.id)).not.toBeNull()
    expect(await dispatchedOf(rows.signal.id)).toBeNull()
    expect(await dispatchedOf(rows.wake.id)).toBeNull()
  })

  it('drains only the v1 rows with drainLegacy', async () => {
    const rows = await seedRows()
    const legacy = recordingLegacy()
    const { dispatcher, reconcile } = rig({ legacy })

    expect(await dispatcher.drainLegacy()).toBe(2)

    expect(legacy.threadChanged).toHaveBeenCalledWith({ threadId: 'thr_1' })
    expect(legacy.notifyEvent).toHaveBeenCalledTimes(1)
    expect(reconcile).not.toHaveBeenCalled()
    expect(await dispatchedOf(rows.reconcile.id)).toBeNull()
  })

  it('runs every kind when it holds the legacy port', async () => {
    await seedRows()
    const { dispatcher } = rig({ legacy: recordingLegacy() })

    expect(await dispatcher.drain()).toBe(3)
  })

  it('refuses drainLegacy without the legacy port', () => {
    expect(() => rig({}).dispatcher.drainLegacy()).toThrow()
  })
})
