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
import { legacyOf } from './github-legacy-effects.fixture'

const REPO = 'compai/app'
const HEAD = 'abc123'
const DEDUPE_PREFIX = `reconcile-checks:${REPO}:${HEAD}:`

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

const renamed = (): PrObservation => ({
  kind: 'pull',
  source: EPrSource.WebhookPull,
  observedAt: '2026-11-18T10:05:00Z',
  sample: { ...SAMPLE, title: 'add the thing again', pullUpdatedAt: '2026-11-18T10:05:00Z' },
})

const applyArgs = (observations: readonly PrObservation[]) => ({
  repoFullName: REPO,
  prNumber: 42,
  observations,
})

const run = (args: { id: number; name: string; conclusion?: string }): CommitCheckInput =>
  checkRunInputOf({
    id: args.id,
    name: args.name,
    status: 'completed',
    conclusion: args.conclusion ?? 'success',
    started_at: '2026-11-18T09:59:00Z',
    completed_at: '2026-11-18T10:00:00Z',
  })

const started = (args: { id: number; name: string }): CommitCheckInput =>
  checkRunInputOf({
    id: args.id,
    name: args.name,
    status: 'in_progress',
    conclusion: null,
    started_at: '2026-11-18T09:58:00Z',
  })

const seedChecks = (checks: readonly CommitCheckInput[]) =>
  recordCommitChecksLocked({ repoFullName: REPO, headSha: HEAD, checks })

const seedCheck = (args: { conclusion?: string; id: number; name: string }) =>
  seedChecks([run(args)])

const seedStarted = (args: { id: number; name: string }) => seedChecks([started(args)])

const REST_CHECKS = [
  run({ id: 9, name: 'ci' }),
  run({ id: 10, name: 'lint', conclusion: 'failure' }),
]

function rig(
  args: {
    answers?: readonly (readonly CommitCheckInput[])[]
    refusals?: number
    tokens?: readonly (string | undefined)[]
  } = {},
) {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: vi.fn() } as unknown as GithubSandboxWakeService
  const answers = args.answers ?? [REST_CHECKS]
  const tokens = args.tokens ?? ['gho_fill']
  const reads: string[] = []
  let clock = Date.now()
  let refusals = args.refusals ?? 0
  let tokenCalls = 0
  let store: GithubPrStore | null = null
  const reconcile = new GithubPrReconcile({
    store: () => {
      if (store === null) throw new Error('reconcile ran before the store was built')
      return store
    },
    fillTokenOf: async () => tokens[Math.min(tokenCalls++, tokens.length - 1)],
    reads: {
      readHeadChecksOf: async (request: { headSha: string }) => {
        reads.push(request.headSha)
        if (refusals > 0) {
          refusals -= 1
          throw new GithubHttpBudgetUnavailable()
        }

        return [...(answers[Math.min(reads.length - 1, answers.length - 1)] ?? REST_CHECKS)]
      },
    },
    budget: {} as GithubHttpBudget,
  })
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout,
    legacy: legacyOf({ signals: inertSignals(), wake: wake }),
    reconcile: (request) => reconcile.run(request),
    mergeability: async () => undefined,
    now: () => new Date(clock),
  })
  store = new GithubPrStore({
    mailbox: new GithubPrEventMailboxService(fanout, dispatcher),
    dispatcher,
  })

  const advance = (ms: number): void => {
    clock += ms
  }

  return { store, dispatcher, reads, advance }
}

const outboxRows = () => db.orm.public.GithubPrOutbox.all()

const reconcileRows = async () =>
  (await outboxRows()).filter((row) => row.kind === 'reconcile-checks')

const reconcileKeys = async () => (await reconcileRows()).map((row) => row.dedupeKey)

const checkKeys = async () =>
  (await db.orm.public.GithubCommitCheck.all()).map((row) => row.checkKey).sort()

describe('a rerun that GitHub re-creates without a delivery', () => {
  useTestDatabase()

  describe('on a subscribed head', () => {
    beforeEach(async () => {
      await seedSubscription({ userId: 'usr-a', prNumber: 42, threadId: 'thr_1' })
    })

    it('reads the head, confirms it once and replaces the stale sibling ids', async () => {
      await seedCheck({ id: 1, name: 'ci' })
      await seedCheck({ id: 2, name: 'ci' })
      const { store, reads } = rig()

      await store.apply(applyArgs([pull()]))

      expect(reads).toEqual([HEAD, HEAD])
      const rows = await reconcileRows()
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ payload: { repoFullName: REPO, headSha: HEAD } })
      for (const key of await reconcileKeys()) expect(key?.startsWith(DEDUPE_PREFIX)).toBe(true)
      const state = await db.orm.public.GithubPrState.first()
      expect(state).toMatchObject({ checksPassed: 1, checksFailed: 1, checksIgnored: 0 })
      expect(await checkKeys()).toEqual(['run:1', 'run:10', 'run:2', 'run:9'])
    })

    it('parks the row when the budget refuses the read and drains it once the window opens', async () => {
      await seedCheck({ id: 1, name: 'ci' })
      await seedCheck({ id: 2, name: 'ci' })
      const { store, dispatcher, reads, advance } = rig({ refusals: 1 })

      await store.apply(applyArgs([pull()]))

      expect(await reconcileRows()).toMatchObject([{ dispatchedAt: null, attempts: 0 }])

      advance(60_000)
      expect(await dispatcher.drain()).toBe(1)

      expect(reads).toEqual([HEAD, HEAD, HEAD])
      for (const row of await reconcileRows()) expect(row.dispatchedAt).not.toBeNull()
    })
  })

  it('writes no event, delivery or inbox row on a head nobody subscribed to', async () => {
    await seedCheck({ id: 1, name: 'ci' })
    await seedCheck({ id: 2, name: 'ci' })
    const { store, reads } = rig()

    await store.apply(applyArgs([pull()]))

    expect(reads).toEqual([HEAD, HEAD])
    expect(await reconcileRows()).toHaveLength(2)
    const state = await db.orm.public.GithubPrState.first()
    expect(state).toMatchObject({ checksPassed: 1, checksFailed: 1 })
    expect(await db.orm.public.GithubPrEvent.all()).toHaveLength(0)
    expect(await db.orm.public.GithubPrEventDelivery.all()).toHaveLength(0)
    expect(await db.orm.public.GithubWebhookInbox.all()).toHaveLength(0)
  })
})

describe('a reconcile per rerun generation', () => {
  useTestDatabase()

  it('reads once for each of two rerun generations on the same head', async () => {
    await seedCheck({ id: 1, name: 'ci' })
    await seedCheck({ id: 2, name: 'ci' })
    const { store, reads } = rig({
      answers: [[run({ id: 1, name: 'ci' }), run({ id: 2, name: 'ci' })]],
    })

    await store.apply(applyArgs([pull()]))
    await seedStarted({ id: 3, name: 'ci' })
    await store.apply(applyArgs([]))

    expect(reads).toEqual([HEAD, HEAD])
    const keys = await reconcileKeys()
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)

    await store.apply(applyArgs([]))

    expect(reads).toEqual([HEAD, HEAD])
    expect(await reconcileRows()).toHaveLength(2)
  })

  it('writes no new row when the same generation is applied again', async () => {
    await seedCheck({ id: 1, name: 'ci' })
    await seedCheck({ id: 2, name: 'ci' })
    const { store, reads } = rig({
      answers: [[run({ id: 1, name: 'ci' }), run({ id: 2, name: 'ci' })]],
    })

    await store.apply(applyArgs([pull()]))
    await store.apply(applyArgs([renamed()]))

    const state = await db.orm.public.GithubPrState.first()
    expect(state?.title).toBe('add the thing again')
    expect(reads).toEqual([HEAD])
    expect(await reconcileRows()).toHaveLength(1)
  })

  it('leaves the row pending, with no read, until an installation token arrives', async () => {
    await seedCheck({ id: 1, name: 'ci' })
    await seedCheck({ id: 2, name: 'ci' })
    const { store, dispatcher, reads, advance } = rig({
      answers: [[run({ id: 1, name: 'ci' }), run({ id: 2, name: 'ci' })]],
      tokens: [undefined, 'gho_fill'],
    })

    await store.apply(applyArgs([pull()]))

    expect(reads).toEqual([])
    expect(await reconcileRows()).toMatchObject([{ attempts: 0, dispatchedAt: null }])

    advance(60_000)
    expect(await dispatcher.drain()).toBe(1)

    expect(reads).toEqual([HEAD])
    expect((await reconcileRows())[0]?.dispatchedAt).not.toBeNull()
  })

  it('picks up a sibling re-created after the first read once the rerun attempt completes', async () => {
    await seedCheck({ id: 1, name: 'ci' })
    await seedStarted({ id: 2, name: 'ci' })
    const { store, reads } = rig({
      answers: [
        [run({ id: 1, name: 'ci' }), started({ id: 2, name: 'ci' })],
        [run({ id: 1, name: 'ci' }), run({ id: 2, name: 'ci' }), run({ id: 3, name: 'ci' })],
      ],
    })

    await store.apply(applyArgs([pull()]))

    expect(reads).toEqual([HEAD])
    expect(await checkKeys()).toEqual(['run:1', 'run:2'])

    await seedCheck({ id: 2, name: 'ci' })
    const before = reads.length
    await store.apply(applyArgs([]))

    expect(reads.length - before).toBeLessThanOrEqual(2)
    expect(await checkKeys()).toEqual(['run:1', 'run:2', 'run:3'])
  })
})
