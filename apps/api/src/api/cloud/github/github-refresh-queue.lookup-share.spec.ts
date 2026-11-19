import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ETargetOutcome } from '@dltech/atlas-core'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { ensureUsers } from '../../../../test/github-seed'
import type { QueueDeps, TargetAttempt } from './github-refresh-queue'
import { EGithubCallSource } from './github-call-log'
import { EGithubHttpCategory } from './github-request-coordinator.types'
import { githubCallIdentity } from './github-fetch'
import { GithubRequestCoordinator } from './github-request-coordinator'
import type { GithubService } from './github.service'
import {
  GithubHttpBudgetUnavailable,
  credentialFingerprint,
  takeGithubRequestSlot,
  withGithubRequestBudget,
} from './github-request-budget'
import {
  LOOKUP_SHARE,
  NUMBERED_LOOKUP_CALLS,
  queueDeps,
  seedSubscription,
  seedTarget,
  sweep,
} from './github-refresh-queue.fixture'

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

  it('serves a known refresh behind 48 unresolved branches, charging each branch to Lookup', async () => {
    const redis = await createRealRedisService()
    try {
      const coordinator = new GithubRequestCoordinator(
        redis,
        { findToken: async () => undefined } as unknown as GithubService,
        `spec:${randomUUID()}:`,
      )
      const token = 'ghu_branches'
      const lookUp = numberedLookUp(token)
      const refresh = numberedRefresh(token, 42)
      for (let index = 0; index < 48; index += 1) {
        await seedSubscription(index)
        await seedTarget(index)
      }
      await seedTarget(48, {
        kind: 'pull-request',
        prNumber: 42,
        branch: '',
        lookedUpAt: new Date(),
        nextDueAt: new Date(Date.now() - 1),
      })

      await withGithubRequestBudget({
        store: coordinator,
        run: () => sweep(queueDeps({ lookUp, refresh })),
      })

      const outcomes = await Promise.all(
        lookUp.mock.results.map((result) => result.value as Promise<TargetAttempt>),
      )
      expect(lookUp).toHaveBeenCalledTimes(48)
      expect(
        outcomes.filter((outcome) => outcome.outcome === ETargetOutcome.LookedUp),
      ).toHaveLength(Math.floor(LOOKUP_SHARE / NUMBERED_LOOKUP_CALLS))
      expect(refresh).toHaveBeenCalledTimes(1)
      const subscriptions = await db.orm.public.GithubSubscription.all()
      expect(subscriptions.map((row) => row.prNumber)).toEqual(Array(48).fill(null))
    } finally {
      await redis.onModuleDestroy()
    }
  })
})
