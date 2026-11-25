import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { GithubPrOutboxDispatcher, PR_OUTBOX_BATCH } from './github-pr-outbox'
import { GithubHttpBudgetUnavailable } from './github-request-budget'

const AT = new Date('2026-11-18T10:00:00Z')

const fanoutRow = (args: { createdAt: Date }) => ({
  id: `out_${randomUUID()}`,
  kind: 'fanout',
  repoFullName: 'compai/app',
  prNumber: 42,
  payload: { userIds: ['usr-a'], state: { repoFullName: 'compai/app', prNumber: 42 } },
  dedupeKey: `fanout:${randomUUID()}`,
  createdAt: args.createdAt,
  dispatchedAt: null,
  attempts: 0,
  lastError: null,
})

const parkedReconcileRow = (args: { createdAt: Date }) => ({
  ...fanoutRow(args),
  kind: 'reconcile-checks',
  payload: { repoFullName: 'compai/app', headSha: 'abc123' },
  nextAttemptAt: AT,
})

function rig() {
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push: () => undefined, pushEvent: () => undefined } as never,
    reconcile: async () => {
      throw new GithubHttpBudgetUnavailable()
    },
    mergeability: async () => undefined,
    logger: { warn: () => undefined },
    now: () => AT,
  })

  return { dispatcher }
}

const reload = (id: string) => db.orm.public.GithubPrOutbox.where({ id }).first()

describe('GithubPrOutboxDispatcher fairness', () => {
  useTestDatabase()

  it('delivers a valid row ahead of a full batch of parked rows', async () => {
    const parked = Array.from({ length: PR_OUTBOX_BATCH }, (_, index) =>
      parkedReconcileRow({ createdAt: new Date(AT.getTime() + index) }),
    )
    await db.orm.public.GithubPrOutbox.createAndCount(parked)
    const valid = await db.orm.public.GithubPrOutbox.create(
      fanoutRow({ createdAt: new Date(AT.getTime() + 100) }),
    )
    const { dispatcher } = rig()

    expect(await dispatcher.drain()).toBe(PR_OUTBOX_BATCH + 1)
    expect((await reload(valid.id))?.dispatchedAt).not.toBeNull()
    expect(await reload(parked[0]?.id ?? '')).toMatchObject({ attempts: 0, dispatchedAt: null })
  })

  it('keeps claiming bounded batches until the due queue is empty', async () => {
    const rows = Array.from({ length: PR_OUTBOX_BATCH + 8 }, (_, index) =>
      fanoutRow({ createdAt: new Date(AT.getTime() + index) }),
    )
    await db.orm.public.GithubPrOutbox.createAndCount(rows)
    const { dispatcher } = rig()

    expect(await dispatcher.drain()).toBe(PR_OUTBOX_BATCH + 8)
    expect(await dispatcher.drain()).toBe(0)
  })
})
