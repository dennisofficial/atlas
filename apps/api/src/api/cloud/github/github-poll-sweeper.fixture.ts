import { db, type Row } from '@dltech/atlas-db'
import { expect, vi } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { localCoordinator } from './github-request-coordinator.fixture'
import {
  ensureUsers,
  seedPrState as seedPrStateRow,
  seedSubscription as seedSubscriptionRow,
} from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubHeadReads } from './github-head-reads'
import { observationReadOf } from './github-pr-read.fixture'
import { storeFixture } from './github-pr-store.fixture'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import type { GithubUserReads } from './github-user-reads'
import type { RestPullRequest } from './github-pull-request-mapping'
import type { GithubService } from './github.service'

export const REST_FIELDS: PullRequestCacheFields = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 1,
  checksIgnored: 0,
  checksState: null,
  mergeable: false,
}

export const preparePollSweeper = async (): Promise<void> => {
  vi.useRealTimers()
  await ensureUsers('usr_1', 'usr_2')
}

export function serviceWith(args: {
  tokens?: Record<string, string>
  readPullRequest?: GithubUserReads['readPullRequest']
  findOpenPrForBranch?: GithubUserReads['findOpenPrForBranch']
  headReads?: GithubHeadReads
}): { service: GithubPollSweeperService; fanout: GithubPrFanoutService } {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const readPullRequest = args.readPullRequest ?? (async () => REST_FIELDS)
  const reads = {
    readPullRequest,
    readPullRequestObservation: async (input: { number: number }) =>
      observationReadOf({ fields: await readPullRequest(input as never), number: input.number }),
    findOpenPrForBranch: args.findOpenPrForBranch ?? (async () => null),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const hooks = { ensureHook: async () => 'poll-backed' } as unknown as GithubHookLifecycleService
  return {
    service: new GithubPollSweeperService(
      github,
      reads,
      hooks,
      localCoordinator(github),
      args.headReads ?? (new GithubHeadReads() as unknown as GithubHeadReads),
      storeFixture({ fanout }),
    ),
    fanout,
  }
}

export const seedSubscription = (overrides: Partial<Row<'GithubSubscription'>> = {}) =>
  seedSubscriptionRow({
    id: 'sub-1',
    userId: 'usr_1',
    branch: '#42',
    pollBacked: true,
    ...overrides,
  })

export const seedPrState = (overrides: Partial<Row<'GithubPrState'>> = {}) =>
  seedPrStateRow({ checksPassed: 3, checksFailed: 1, mergeable: false, ...overrides })

export const REST_PULL: RestPullRequest = {
  number: 7,
  title: 'add the thing',
  html_url: 'https://github.com/compai/app/pull/7',
  state: 'open',
  draft: false,
  merged_at: null,
  updated_at: '2026-11-18T00:00:00Z',
  mergeable: null,
  mergeable_state: 'unknown',
  head: { ref: 'dennis/feature', sha: 'abc123', repo: { full_name: 'compai/app' } },
  base: { ref: 'main' },
}

export const seedTarget = (overrides: Partial<Row<'GithubTrackingTarget'>> = {}) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: 'compai/app',
    branch: 'dennis/feature',
    prNumber: 0,
    lookedUpAt: null,
    liveUntil: new Date(Date.now() + 60 * 60_000),
    ...overrides,
  })

export const fakeHeadReads = (
  args: { pulls?: Record<string, RestPullRequest[]>; parent?: Record<string, string | null> } = {},
) => {
  const pullsByHead = vi.fn(
    async (input: { repoFullName: string }) => args.pulls?.[input.repoFullName] ?? [],
  )
  const parentOf = vi.fn(
    async (input: { repoFullName: string }) => args.parent?.[input.repoFullName] ?? null,
  )
  return {
    reads: { pullsByHead, parentOf } as unknown as GithubHeadReads,
    pullsByHead,
    parentOf,
  }
}

export const covered = () =>
  db.orm.public.GithubAppInstallation.create({
    installationId: 11n,
    accountLogin: 'compai',
    accountType: 'Organization',
    repos: ['compai/app'],
    suspendedAt: null,
  })

export const trackHead = async (args: { sessionId: string; branch: string }): Promise<void> => {
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  await plane.createSession({
    sessionId: args.sessionId,
    userId: 'usr_1',
    projectId: 'proj_1',
    mainThreadId: `${args.sessionId}-thread`,
  })
  const lease = await plane.grant({ sessionId: args.sessionId, hostId: 1 })
  const outcome = await plane.append({
    threadId: `${args.sessionId}-thread`,
    epoch: lease.epoch,
    events: chainEvents({
      threadId: toThreadId(`${args.sessionId}-thread`),
      runId: toRunId('run-1'),
      epoch: lease.epoch,
      at: new Date().toISOString(),
      bodies: [
        {
          type: 'branches-observed',
          repo: '/work/app',
          head: args.branch,
          base: 'main',
          branches: [{ name: args.branch, sha: 'abc123' }],
          worktrees: [],
          remotes: [{ name: 'origin', url: 'git@github.com:compai/app.git' }],
        },
      ],
    }),
  })
  expect(outcome.ok).toBe(true)
}
