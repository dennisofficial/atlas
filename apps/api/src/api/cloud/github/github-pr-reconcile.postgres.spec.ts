import { EPrSource, EPrState, type PrObservation, type PullSample } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSubscription } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import {
  checkRunInputOf,
  type CommitCheckInput,
  recordCommitChecksLocked,
} from './github-commit-checks'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrReconcile } from './github-pr-reconcile'
import { GithubPrStore } from './github-pr-store'
import { GithubHttpBudgetUnavailable, type GithubHttpBudget } from './github-request-budget'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

const REPO = 'compai/app'
const HEAD = 'abc123'
const DEDUPE_KEY = `reconcile-checks:${REPO}:${HEAD}`

const SAMPLE: PullSample = {
  repoFullName: REPO,
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: EPrState.Open,
  headBranch: 'dennis/add-the-thing',
  headSha: HEAD,
  headRepoFullName: REPO,
  baseBranch: 'main',
  pullUpdatedAt: '2026-11-18T10:00:00Z',
  closedAt: null,
  mergedAt: null,
}

const pull = (): PrObservation => ({
  kind: 'pull',
  source: EPrSource.WebhookPull,
  observedAt: '2026-11-18T10:00:00Z',
  sample: SAMPLE,
})

const applyArgs = (observations: readonly PrObservation[]) => ({
  repoFullName: REPO,
  prNumber: 42,
  observations,
})

const run = (args: { id: number; name: string; conclusion: string }): CommitCheckInput =>
  checkRunInputOf({
    id: args.id,
    name: args.name,
    status: 'completed',
    conclusion: args.conclusion,
    started_at: '2026-11-18T09:59:00Z',
    completed_at: '2026-11-18T10:00:00Z',
  })

const seedCheck = (args: { id: number; name: string; conclusion?: string }) =>
  recordCommitChecksLocked({
    repoFullName: REPO,
    headSha: HEAD,
    checks: [run({ id: args.id, name: args.name, conclusion: args.conclusion ?? 'success' })],
  })

const REST_CHECKS = [
  run({ id: 9, name: 'ci', conclusion: 'success' }),
  run({ id: 10, name: 'lint', conclusion: 'failure' }),
]

function rig(args: { refusals?: number } = {}) {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: vi.fn() } as unknown as GithubSandboxWakeService
  const reads: string[] = []
  let refusals = args.refusals ?? 0
  let store: GithubPrStore | null = null
  const reconcile = new GithubPrReconcile({
    store: () => {
      if (store === null) throw new Error('reconcile ran before the store was built')
      return store
    },
    fillTokenOf: async () => 'gho_fill',
    reads: {
      readHeadChecksOf: async (request: { headSha: string }) => {
        reads.push(request.headSha)
        if (refusals > 0) {
          refusals -= 1
          throw new GithubHttpBudgetUnavailable()
        }
        return REST_CHECKS
      },
    },
    budget: {} as GithubHttpBudget,
  })
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout,
    signals: inertSignals(),
    wake,
    reconcile: (request) => reconcile.run(request),
  })
  store = new GithubPrStore({
    mailbox: new GithubPrEventMailboxService(fanout, dispatcher),
    dispatcher,
  })

  return { store, dispatcher, reads }
}

const outboxRows = () => db.orm.public.GithubPrOutbox.all()

describe('a rerun that GitHub re-creates without a delivery', () => {
  useTestDatabase()

  describe('on a subscribed head', () => {
    beforeEach(async () => {
      await seedSubscription({ userId: 'usr-a', prNumber: 42, threadId: 'thr_1' })
    })

    it('reads the head once and replaces the sibling attempts with the ids GitHub holds', async () => {
      await seedCheck({ id: 1, name: 'ci' })
      await seedCheck({ id: 2, name: 'ci' })
      const { store, reads } = rig()

      await store.apply(applyArgs([pull()]))
      await store.apply(applyArgs([]))

      expect(reads).toEqual([HEAD])
      const rows = await outboxRows()
      expect(rows.filter((row) => row.kind === 'reconcile-checks')).toHaveLength(1)
      expect(rows.find((row) => row.kind === 'reconcile-checks')).toMatchObject({
        payload: { repoFullName: REPO, headSha: HEAD },
        dedupeKey: DEDUPE_KEY,
      })
      const state = await db.orm.public.GithubPrState.first()
      expect(state).toMatchObject({ checksPassed: 1, checksFailed: 1, checksIgnored: 0 })
      const keys = (await db.orm.public.GithubCommitCheck.all()).map((row) => row.checkKey).sort()
      expect(keys).toEqual(['run:1', 'run:10', 'run:2', 'run:9'])
    })

    it('parks the row when the budget refuses the read and drains it once the window opens', async () => {
      await seedCheck({ id: 1, name: 'ci' })
      await seedCheck({ id: 2, name: 'ci' })
      const { store, dispatcher, reads } = rig({ refusals: 1 })

      await store.apply(applyArgs([pull()]))

      const parked = (await outboxRows()).find((row) => row.kind === 'reconcile-checks')
      expect(parked).toMatchObject({ dispatchedAt: null, attempts: 1 })

      expect(await dispatcher.drain()).toBe(1)

      expect(reads).toEqual([HEAD, HEAD])
      expect((await outboxRows()).find((row) => row.kind === 'reconcile-checks')).toMatchObject({
        dispatchedAt: expect.anything(),
        attempts: 1,
      })
    })
  })

  it('writes no event, delivery or inbox row on a head nobody subscribed to', async () => {
    await seedCheck({ id: 1, name: 'ci' })
    await seedCheck({ id: 2, name: 'ci' })
    const { store, reads } = rig()

    await store.apply(applyArgs([pull()]))

    expect(reads).toEqual([HEAD])
    expect((await outboxRows()).filter((row) => row.kind === 'reconcile-checks')).toHaveLength(1)
    const state = await db.orm.public.GithubPrState.first()
    expect(state).toMatchObject({ checksPassed: 1, checksFailed: 1 })
    expect(await db.orm.public.GithubPrEvent.all()).toHaveLength(0)
    expect(await db.orm.public.GithubPrEventDelivery.all()).toHaveLength(0)
    expect(await db.orm.public.GithubWebhookInbox.all()).toHaveLength(0)
  })
})
