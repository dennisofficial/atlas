import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
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

const seedV1Rows = async () => ({
  signal: await db.orm.public.GithubPrOutbox.create(
    rowOf({ kind: 'thread-signal', payload: { threadId: 'thr_1' } }),
  ),
  wake: await db.orm.public.GithubPrOutbox.create(
    rowOf({
      kind: 'wake',
      payload: { notice: { userId: 'usr-a', repoFullName: 'compai/app', prNumber: 42 } },
    }),
  ),
})

const seedRow = () =>
  db.orm.public.GithubPrOutbox.create(
    rowOf({ kind: 'reconcile-checks', payload: { repoFullName: 'compai/app', headSha: 'abc' } }),
  )

const rowById = async (id: string) => db.orm.public.GithubPrOutbox.where({ id }).first()

function rig() {
  const reconcile = vi.fn(async () => undefined)
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push: vi.fn(), pushEvent: vi.fn() },
    reconcile,
    mergeability: async () => undefined,
    logger: { warn: () => undefined },
    now: () => AT,
  })

  return { dispatcher, reconcile }
}

describe('GithubPrOutboxDispatcher over the rows the v1 outbox left behind', () => {
  useTestDatabase()

  it('drains the v2 rows and leaves every v1 row unclaimed', async () => {
    const rows = await seedV1Rows()
    const reconcileRow = await seedRow()
    const { dispatcher, reconcile } = rig()

    expect(await dispatcher.drain()).toBe(1)

    expect(reconcile).toHaveBeenCalledTimes(1)
    expect((await rowById(reconcileRow.id))?.dispatchedAt).not.toBeNull()
    for (const id of [rows.signal.id, rows.wake.id]) {
      expect(await rowById(id)).toMatchObject({
        dispatchedAt: null,
        attempts: 0,
        deadLetteredAt: null,
      })
    }
  })

  it('claims nothing when the outbox holds only v1 rows', async () => {
    await seedV1Rows()
    const { dispatcher, reconcile } = rig()

    expect(await dispatcher.drain()).toBe(0)
    expect(reconcile).not.toHaveBeenCalled()
  })
})
