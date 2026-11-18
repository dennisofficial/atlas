import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, setSystemTime, vi } from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { ensureUsers, seedSubscription } from '../../../../test/github-seed'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { refreshGithubQueue } from './github-refresh-queue'
import { EGithubCallSource } from './github-call-log'
import { GITHUB_LOOKUP_HTTP_BUDGET_PER_MINUTE } from './github-request-coordinator.types'
import { githubCallIdentity } from './github-fetch'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { localCoordinator } from './github-request-coordinator.fixture'
import type { GithubService } from './github.service'
import {
  GithubHttpBudgetUnavailable,
  credentialFingerprint,
  takeGithubRequestSlot,
  withGithubRequestBudget,
} from './github-request-budget'
import type { TransportSelector } from './github-transport-selector'

const COVERED_REPO = 'compai/covered'
const POLLED_REPO = 'compai/polled'
const NUMBERED_LOOKUP_CALLS = 5

const seedHead = (index: number, overrides: Record<string, unknown> = {}) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: POLLED_REPO,
    branch: `dennis/head-${index}`,
    prNumber: 0,
    lookedUpAt: null,
    liveUntil: new Date(Date.now() + 3_600_000),
    ...overrides,
  })

type QueueDeps = Parameters<typeof refreshGithubQueue>[0]

const queueDeps = (args: {
  lookUp: QueueDeps['lookUp']
  refresh: QueueDeps['refresh']
  coordinator?: QueueDeps['coordinator']
}): QueueDeps => ({
  coordinator: args.coordinator ?? localCoordinator(),
  hooks: { ensureHook: async () => 'poll-backed' } as unknown as GithubHookLifecycleService,
  transport: {
    polls: async (repo: string) => repo !== COVERED_REPO,
  } as unknown as TransportSelector,
  logger: new Logger('refresh-queue-spec'),
  resolve: async () => null,
  refresh: args.refresh,
  lookUp: args.lookUp,
})

describe('refreshGithubQueue ordering', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('attempts every polled head, oldest attempt first, in one sweep', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => 'looked-up')
    const refresh = vi.fn<QueueDeps['refresh']>(async () => 'polled')
    const untouched = await seedHead(0)
    const oldest = await seedHead(1, { attemptedAt: new Date(Date.now() - 600_000) })
    const middle = await seedHead(2, { attemptedAt: new Date(Date.now() - 300_000) })
    for (let index = 3; index < 40; index += 1) await seedHead(index)

    await refreshGithubQueue(queueDeps({ lookUp, refresh }))

    const attempted = lookUp.mock.calls.map((call) => call[0].id)
    expect(attempted).toHaveLength(40)
    expect(new Set(attempted).size).toBe(40)
    expect(attempted.filter((id) => id === untouched.id)).toHaveLength(1)
    expect(attempted.indexOf(oldest.id)).toBeLessThan(attempted.indexOf(middle.id))
    expect(attempted.slice(0, 3)).toContain(untouched.id)
  })

  it('refreshes a known pull request even when the lookup phase is refused the budget', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => 'rate-limited')
    const refresh = vi.fn<QueueDeps['refresh']>(async () => 'polled')
    await seedHead(0)
    await seedSubscription({ prNumber: 42, branch: '#42', pollBacked: true })

    await refreshGithubQueue(queueDeps({ lookUp, refresh }))

    expect(refresh).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
  })

  it('keeps retrying a superseded lookup without charging it a failure', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => 'superseded')
    const refresh = vi.fn<QueueDeps['refresh']>(async () => 'polled')
    await seedHead(0)
    const deps = queueDeps({ lookUp, refresh })

    const startedAt = Date.now()
    await refreshGithubQueue(deps)
    setSystemTime(new Date(startedAt + 31_000))
    try {
      await refreshGithubQueue(deps)
    } finally {
      setSystemTime()
    }

    expect(lookUp).toHaveBeenCalledTimes(2)
    expect(await deps.coordinator.attempt({ key: `head:${POLLED_REPO}#dennis/head-0` })).toEqual(
      expect.objectContaining({ failures: 0 }),
    )
  })
})

describe('refreshGithubQueue budget reservation', () => {
  useTestDatabase()

  const numberedLookUp = (token: string) =>
    vi.fn<QueueDeps['lookUp']>(async () => {
      try {
        for (let index = 0; index < NUMBERED_LOOKUP_CALLS; index += 1)
          await takeGithubRequestSlot(
            githubCallIdentity({
              source: EGithubCallSource.PollSweep,
              token,
              url: `https://api.github.com/repos/compai/polled/pulls/${index}`,
            }),
          )
      } catch (failure) {
        if (failure instanceof GithubHttpBudgetUnavailable) return 'rate-limited'
        throw failure
      }
      return 'looked-up'
    })

  const knownPrRefresh = (token: string) =>
    vi.fn<QueueDeps['refresh']>(async () => {
      await takeGithubRequestSlot(
        githubCallIdentity({
          source: EGithubCallSource.PollSweep,
          token,
          url: 'https://api.github.com/repos/compai/app/pulls/42',
        }),
      )
      return 'polled'
    })

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('reserves the refresh share of the minute when numbered lookups are plentiful', async () => {
    const redis = await createRealRedisService()
    try {
      const coordinator = new GithubRequestCoordinator(
        redis,
        { findToken: async () => undefined } as unknown as GithubService,
        `spec:${randomUUID()}:`,
      )
      const token = 'ghu_shared'
      const lookUp = numberedLookUp(token)
      const refresh = knownPrRefresh(token)
      for (let index = 0; index < 40; index += 1)
        await seedHead(index, { kind: 'pull-request', prNumber: 1000 + index })
      await seedSubscription({ prNumber: 42, branch: '#42', pollBacked: true })

      await withGithubRequestBudget({
        store: coordinator,
        run: () => refreshGithubQueue(queueDeps({ lookUp, refresh, coordinator })),
      })

      expect(lookUp).toHaveBeenCalledTimes(
        Math.ceil(GITHUB_LOOKUP_HTTP_BUDGET_PER_MINUTE / NUMBERED_LOOKUP_CALLS),
      )
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(
        await coordinator.takeHttpSlot({
          credentialFingerprint: credentialFingerprint(token),
          resource: 'core',
        }),
      ).toBe(true)
    } finally {
      await redis.onModuleDestroy()
    }
  })
})
