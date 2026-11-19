import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedPrState } from '../../../../test/github-seed'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { PR_OUTBOX_MAX_ATTEMPTS } from './github-pr-outbox-lease'
import { GithubPrReconcile } from './github-pr-reconcile'
import type { GithubPrStore } from './github-pr-store'
import { GithubHttpBudgetUnavailable, type GithubHttpBudget } from './github-request-budget'
import type { GithubUserReads } from './github-user-reads'

const REPO = 'compai/app'
const HEAD = 'abc123'

const seedRow = (id: string): Promise<Row<'GithubPrOutbox'>> =>
  db.orm.public.GithubPrOutbox.create({
    id,
    kind: 'reconcile-checks',
    repoFullName: REPO,
    prNumber: 42,
    payload: { repoFullName: REPO, headSha: HEAD },
    dedupeKey: `reconcile-checks:${id}`,
    createdAt: new Date(),
    dispatchedAt: null,
    attempts: 0,
    lastError: null,
  })

const row = (id: string) => db.orm.public.GithubPrOutbox.where({ id }).first()

function rig(args: { refusals?: number; outboxIds?: string[][] } = {}) {
  const reads: string[] = []
  const planned = args.outboxIds ?? [[]]
  let refusals = args.refusals ?? 0
  let clock = Date.now()
  let applied = 0
  let dispatcher: GithubPrOutboxDispatcher | null = null
  const store = {
    applyWithin: async () => ({
      applied: true,
      row: null,
      changed: [],
      outboxIds: planned[Math.min(applied++, planned.length - 1)] ?? [],
    }),
    dispatch: (ids: readonly string[]) => dispatcher?.dispatch(ids),
  } as unknown as GithubPrStore
  const reconcile = new GithubPrReconcile({
    store: () => store,
    fillTokenOf: async () => 'gho_fill',
    reads: {
      readHeadChecksOf: async (request: { headSha: string }) => {
        reads.push(request.headSha)
        if (refusals > 0) {
          refusals -= 1
          throw new GithubHttpBudgetUnavailable()
        }

        return []
      },
    } as Pick<GithubUserReads, 'readHeadChecksOf'>,
    budget: {} as GithubHttpBudget,
  })
  dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push: () => undefined, pushEvent: () => undefined } as never,
    signals: { threadChanged: () => undefined } as never,
    wake: { notifyEvent: async () => undefined } as never,
    reconcile: (request) => reconcile.run(request),
    logger: { warn: () => undefined },
    now: () => new Date(clock),
  })

  return { dispatcher, reads, advance: (ms: number) => (clock += ms) }
}

describe('a reconcile row the GitHub budget refuses', () => {
  useTestDatabase()

  it('parks for its retry deadline without ever spending an attempt', async () => {
    await seedPrState()
    await seedRow('out_a')
    const { dispatcher, advance } = rig({ refusals: PR_OUTBOX_MAX_ATTEMPTS + 2 })

    for (let round = 0; round < PR_OUTBOX_MAX_ATTEMPTS + 2; round += 1) {
      expect(await dispatcher.drain()).toBe(1)
      expect(await row('out_a')).toMatchObject({
        dispatchedAt: null,
        attempts: 0,
        deadLetteredAt: null,
      })
      advance(60_000)
    }

    expect(await dispatcher.drain()).toBe(1)

    const dispatched = await row('out_a')
    expect(dispatched?.dispatchedAt).not.toBeNull()
    expect(dispatched).toMatchObject({ attempts: 0, deadLetteredAt: null })
  })
})

describe('a reconcile that applies work of its own', () => {
  useTestDatabase()

  it('confirms one successor inline and leaves the rest to the outbox', async () => {
    await seedPrState()
    await seedRow('out_a')
    await seedRow('out_b')
    await seedRow('out_c')
    const { dispatcher, reads } = rig({ outboxIds: [['out_b'], ['out_c']] })

    await dispatcher.dispatch(['out_a'])

    expect(reads).toHaveLength(2)
    expect((await row('out_c'))?.dispatchedAt).toBeNull()

    expect(await dispatcher.drain()).toBe(1)
    expect(reads).toHaveLength(3)
    expect((await row('out_c'))?.dispatchedAt).not.toBeNull()
  })
})
