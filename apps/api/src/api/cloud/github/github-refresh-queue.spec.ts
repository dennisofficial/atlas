import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ETargetOutcome } from '@dltech/atlas-core'
import { ERepoTracking } from '@dltech/atlas-wire'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { ensureUsers } from '../../../../test/github-seed'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { refreshGithubQueue, type QueueDeps, type TargetAttempt } from './github-refresh-queue'
import { EGithubCallSource } from './github-call-log'
import {
  EGithubHttpCategory,
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_RESERVED_FOR_REFRESH,
} from './github-request-coordinator.types'
import { githubCallIdentity } from './github-fetch'
import { GithubRequestCoordinator } from './github-request-coordinator'
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
const LOOKUP_SHARE = GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE - GITHUB_REFRESH_RESERVED_FOR_REFRESH
const NUMBERED_LOOKUP_CALLS = 5

const seedTarget = (index: number, overrides: Record<string, unknown> = {}) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: POLLED_REPO,
    branch: `dennis/head-${index}`,
    prNumber: 0,
    lookedUpAt: null,
    nextDueAt: new Date(Date.now() - 60_000 + index),
    liveUntil: new Date(Date.now() + 3_600_000),
    ...overrides,
  })

const queueDeps = (args: {
  lookUp: QueueDeps['lookUp']
  refresh: QueueDeps['refresh']
}): QueueDeps => ({
  hooks: { ensureHook: async () => 'poll-backed' } as unknown as GithubHookLifecycleService,
  transport: {
    transportOf: async (repo: string) =>
      repo === COVERED_REPO ? ERepoTracking.App : ERepoTracking.Polled,
    polls: async (repo: string) => repo !== COVERED_REPO,
  } as unknown as TransportSelector,
  logger: new Logger('refresh-queue-spec'),
  resolve: async () => null,
  refresh: args.refresh,
  lookUp: args.lookUp,
})

const sweep = (deps: QueueDeps) => refreshGithubQueue({ deps, now: new Date(), limit: 200 })

describe('refreshGithubQueue claims by due time', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('attempts every due polled head once, soonest due first', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => ({ outcome: ETargetOutcome.LookedUp }))
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    const first = await seedTarget(0)
    const second = await seedTarget(1)
    for (let index = 0; index < 40; index += 1) await seedTarget(index + 2)

    await sweep(queueDeps({ lookUp, refresh }))

    const attempted = lookUp.mock.calls.map((call) => call[0].id)
    expect(attempted).toHaveLength(42)
    expect(new Set(attempted).size).toBe(42)
    expect(attempted.slice(0, 2)).toEqual([first.id, second.id])
  })

  it('parks one budget-refused target and still serves the others', async () => {
    const retryAtMs = Date.now() + 300_000
    const parked = await seedTarget(0)
    const lookUp = vi.fn<QueueDeps['lookUp']>(async (target) =>
      target.id === parked.id
        ? { outcome: ETargetOutcome.BudgetRefused, retryAtMs }
        : { outcome: ETargetOutcome.LookedUp },
    )
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    const others = [await seedTarget(1), await seedTarget(2)]

    await sweep(queueDeps({ lookUp, refresh }))

    expect(lookUp.mock.calls.map((call) => call[0].id)).toEqual([
      parked.id,
      ...others.map((row) => row.id),
    ])
    const row = await db.orm.public.GithubTrackingTarget.where({ id: parked.id }).first()
    expect(row?.nextDueAt.getTime()).toBe(retryAtMs)
    expect(row?.failures).toBe(0)
    expect(row?.leaseUntil).toBeNull()
  })

  it('refreshes a known pull request while every lookup is refused the budget', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => ({
      outcome: ETargetOutcome.BudgetRefused,
    }))
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    await seedTarget(0)
    const pull = await seedTarget(1, { kind: 'pull-request', prNumber: 42, lookedUpAt: new Date() })

    await sweep(queueDeps({ lookUp, refresh }))

    expect(refresh).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: POLLED_REPO,
      prNumber: 42,
    })
    const row = await db.orm.public.GithubTrackingTarget.where({ id: pull.id }).first()
    expect(row?.nextDueAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('refreshGithubQueue lookup share of the refresh window', () => {
  useTestDatabase()

  const numberedLookUp = (token: string) =>
    vi.fn<QueueDeps['lookUp']>(async () => {
      try {
        for (let index = 0; index < NUMBERED_LOOKUP_CALLS; index += 1)
          await takeGithubRequestSlot({
            ...githubCallIdentity({
              source: EGithubCallSource.PollSweep,
              token,
              url: `https://api.github.com/repos/compai/polled/pulls/${index}`,
            }),
            category: EGithubHttpCategory.Lookup,
          })
      } catch (failure) {
        if (failure instanceof GithubHttpBudgetUnavailable)
          return { outcome: ETargetOutcome.BudgetRefused, retryAtMs: failure.until }
        throw failure
      }
      return { outcome: ETargetOutcome.LookedUp }
    })

  const numberedRefresh = (token: string, number: number) =>
    vi.fn<QueueDeps['refresh']>(async () => {
      await takeGithubRequestSlot(
        githubCallIdentity({
          source: EGithubCallSource.PollSweep,
          token,
          url: `https://api.github.com/repos/compai/app/pulls/${number}`,
        }),
      )
      return { outcome: ETargetOutcome.Polled }
    })

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('spends at most the share above the refresh reserve and never starves a refresh', async () => {
    const redis = await createRealRedisService()
    try {
      const coordinator = new GithubRequestCoordinator(
        redis,
        { findToken: async () => undefined } as unknown as GithubService,
        `spec:${randomUUID()}:`,
      )
      const token = 'ghu_shared'
      const lookUp = numberedLookUp(token)
      const refresh = numberedRefresh(token, 42)
      for (let index = 0; index < 40; index += 1) await seedTarget(index)
      await seedTarget(41, { kind: 'pull-request', prNumber: 42, lookedUpAt: new Date() })

      await withGithubRequestBudget({
        store: coordinator,
        run: () => sweep(queueDeps({ lookUp, refresh })),
      })

      const outcomes = await Promise.all(
        lookUp.mock.results.map((result) => result.value as Promise<TargetAttempt>),
      )
      expect(
        outcomes.filter((outcome) => outcome.outcome === ETargetOutcome.LookedUp),
      ).toHaveLength(Math.floor(LOOKUP_SHARE / NUMBERED_LOOKUP_CALLS))
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
