import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { GithubPrOutboxDispatcher, PR_OUTBOX_BATCH } from './github-pr-outbox'
import { GithubHttpBudgetUnavailable } from './github-request-budget'

const AT = new Date('2026-11-18T10:00:00Z')

const signalRow = (args: { createdAt: Date }) => ({
  id: `out_${randomUUID()}`,
  kind: 'thread-signal',
  repoFullName: 'compai/app',
  prNumber: 42,
  payload: { threadId: 'thr_1' },
  dedupeKey: `thread-signal:${randomUUID()}`,
  createdAt: args.createdAt,
  dispatchedAt: null,
  attempts: 0,
  lastError: null,
})

const parkedReconcileRow = (args: { createdAt: Date }) => ({
  ...signalRow(args),
  kind: 'reconcile-checks',
  payload: { repoFullName: 'compai/app', headSha: 'abc123' },
  nextAttemptAt: AT,
})

function rig() {
  const { signals, changedThreads } = recordingSignals()
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push: () => undefined, pushEvent: () => undefined } as never,
    signals,
    wake: { notifyEvent: async () => undefined } as never,
    reconcile: async () => {
      throw new GithubHttpBudgetUnavailable()
    },
    mergeability: async () => undefined,
    logger: { warn: () => undefined },
    now: () => AT,
  })

  return { dispatcher, changedThreads }
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
      signalRow({ createdAt: new Date(AT.getTime() + 100) }),
    )
    const { dispatcher, changedThreads } = rig()

    expect(await dispatcher.drain()).toBe(PR_OUTBOX_BATCH + 1)
    expect(changedThreads).toHaveLength(1)
    expect((await reload(valid.id))?.dispatchedAt).not.toBeNull()
    expect(await reload(parked[0]?.id ?? '')).toMatchObject({ attempts: 0, dispatchedAt: null })
  })

  it('keeps claiming bounded batches until the due queue is empty', async () => {
    const rows = Array.from({ length: PR_OUTBOX_BATCH + 8 }, (_, index) =>
      signalRow({ createdAt: new Date(AT.getTime() + index) }),
    )
    await db.orm.public.GithubPrOutbox.createAndCount(rows)
    const { dispatcher, changedThreads } = rig()

    expect(await dispatcher.drain()).toBe(PR_OUTBOX_BATCH + 8)
    expect(changedThreads).toHaveLength(PR_OUTBOX_BATCH + 8)
    expect(await dispatcher.drain()).toBe(0)
  })
})
