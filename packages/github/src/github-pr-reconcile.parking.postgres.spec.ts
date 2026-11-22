import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'
import { seedPrState } from './testing/github-seed'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import {
  PR_OUTBOX_MAX_ATTEMPTS,
  PR_OUTBOX_PARK_EXPIRE_MS,
  PR_OUTBOX_PARK_MS,
} from './github-pr-outbox-lease'
import { GithubPrReconcile } from './github-pr-reconcile'
import type { GithubPrStore } from './github-pr-store'
import { GithubHttpBudgetUnavailable, type GithubHttpBudget } from './github-request-budget'
import { GithubUserReads } from './github-user-reads'
import { legacyOf } from './github-legacy-effects.fixture'

const REPO = 'compai/app'
const GONE_REPO = 'gone/app'
const HEAD = 'abc123'

const seedRow = (id: string, repoFullName = REPO): Promise<Row<'GithubPrOutbox'>> =>
  db.orm.public.GithubPrOutbox.create({
    id,
    kind: 'reconcile-checks',
    repoFullName,
    prNumber: 42,
    payload: { repoFullName, headSha: HEAD },
    dedupeKey: `reconcile-checks:${id}`,
    createdAt: new Date(),
    dispatchedAt: null,
    attempts: 0,
    lastError: null,
  })

const row = (id: string) => db.orm.public.GithubPrOutbox.where({ id }).first()

function rig(
  args: {
    refusals?: number
    outboxIds?: string[][]
    tokenFor?: (repoFullName: string) => string | undefined
    reads?: Pick<GithubUserReads, 'readHeadChecksOf'>
    budget?: GithubHttpBudget
  } = {},
) {
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
    fillTokenOf: async ({ repoFullName }) => (args.tokenFor ?? (() => 'gho_fill'))(repoFullName),
    reads:
      args.reads ??
      ({
        readHeadChecksOf: async (request: { headSha: string }) => {
          reads.push(request.headSha)
          if (refusals > 0) {
            refusals -= 1
            throw new GithubHttpBudgetUnavailable()
          }

          return []
        },
      } as Pick<GithubUserReads, 'readHeadChecksOf'>),
    budget: args.budget ?? ({} as GithubHttpBudget),
  })
  dispatcher = new GithubPrOutboxDispatcher({
    fanout: { push: () => undefined, pushEvent: () => undefined } as never,
    legacy: legacyOf({
      signals: { threadChanged: () => undefined } as never,
      wake: { notifyEvent: async () => undefined } as never,
    }),
    reconcile: (request) => reconcile.run(request),
    mergeability: async () => undefined,
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

function stubGithub429(args: { limited: number }): () => void {
  const original = globalThis.fetch
  let left = args.limited
  globalThis.fetch = (async (target: Parameters<typeof fetch>[0]) => {
    if (left > 0) {
      left -= 1
      return new Response('rate limit exceeded', {
        status: 429,
        headers: { 'retry-after': '30' },
      })
    }
    const url = String(target)

    return url.endsWith('/status')
      ? Response.json({ statuses: [] })
      : Response.json({ check_runs: [] })
  }) as typeof fetch

  return () => {
    globalThis.fetch = original
  }
}

describe('a reconcile GitHub rate-limits', () => {
  useTestDatabase()
  const restores: (() => void)[] = []

  afterEach(() => {
    for (const restore of restores.splice(0)) restore()
  })

  it('parks on the deadline the 429 reports instead of spending attempts, then runs', async () => {
    await seedPrState()
    await seedRow('out_a')
    restores.push(stubGithub429({ limited: PR_OUTBOX_MAX_ATTEMPTS + 2 }))
    const { dispatcher, advance } = rig({
      reads: new GithubUserReads(),
      budget: {
        takeHttpSlot: async () => true,
        blockHttpUntil: async () => undefined,
      },
    })

    for (let round = 0; round < PR_OUTBOX_MAX_ATTEMPTS + 2; round += 1) {
      expect(await dispatcher.drain()).toBe(1)
      const stored = await row('out_a')
      expect(stored).toMatchObject({ dispatchedAt: null, attempts: 0, deadLetteredAt: null })
      expect(stored?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now() + PR_OUTBOX_PARK_MS)
      advance(60_000)
    }

    expect(await dispatcher.drain()).toBe(1)
    expect((await row('out_a'))?.dispatchedAt).not.toBeNull()
  })
})

describe('reconcile rows whose credential source is gone', () => {
  useTestDatabase()

  it('lets live work run behind a full batch of them and retires them after a bounded window', async () => {
    await seedPrState()
    const gone = await Promise.all(
      Array.from({ length: 32 }, (_, index) => seedRow(`out_gone_${index}`, GONE_REPO)),
    )
    await seedRow('out_valid')
    const { dispatcher, reads, advance } = rig({
      tokenFor: (repoFullName) => (repoFullName === GONE_REPO ? undefined : 'gho_fill'),
    })

    expect(await dispatcher.drain()).toBe(33)
    expect(reads).toEqual([HEAD])
    expect((await row('out_valid'))?.dispatchedAt).not.toBeNull()

    expect(await row('out_gone_0')).toMatchObject({ attempts: 0, deadLetteredAt: null })

    advance(PR_OUTBOX_PARK_EXPIRE_MS + 60_000)
    await dispatcher.drain()

    for (const seeded of gone) {
      expect((await row(seeded.id))?.deadLetteredAt).not.toBeNull()
    }
  })
})
