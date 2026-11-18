import { Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ERepoTracking } from '@dltech/atlas-wire'
import { seedSubscription as seedSubscriptionRow } from '../../../../test/github-seed'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { refreshGithubQueue, type QueueDeps } from './github-refresh-queue'
import {
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_RESERVED_FOR_REFRESH,
} from './github-request-coordinator.types'
import type { TransportSelector } from './github-transport-selector'

export const COVERED_REPO = 'compai/covered'
export const POLLED_REPO = 'compai/polled'
export const LOOKUP_SHARE =
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE - GITHUB_REFRESH_RESERVED_FOR_REFRESH
export const NUMBERED_LOOKUP_CALLS = 5

export const seedSubscription = (index: number) =>
  seedSubscriptionRow({
    userId: 'usr_1',
    repoFullName: POLLED_REPO,
    branch: `dennis/head-${index}`,
    prNumber: null,
    pollBacked: true,
  })

export const seedTarget = (index: number, overrides: Record<string, unknown> = {}) =>
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

export const queueDeps = (args: {
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
  refresh: args.refresh,
  lookUp: args.lookUp,
})

export const sweep = (deps: QueueDeps) => refreshGithubQueue({ deps, now: new Date(), limit: 200 })
