import type { Row } from '@dltech/atlas-db'
import { vi } from 'bun:test'
import { localObservations } from './github-observation.fixture'
import {
  ensureUsers,
  seedPrState as seedPrStateRow,
  seedSubscription as seedSubscriptionRow,
} from '../../../../test/github-seed'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { GithubUserReads } from './github-user-reads'
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
}): { service: GithubPollSweeperService; fanout: GithubPrFanoutService } {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
    findOpenPrForBranch: args.findOpenPrForBranch ?? (async () => null),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  const mailbox = new GithubPrEventMailboxService(fanout, wake)
  const hooks = { ensureHook: async () => 'poll-backed' } as unknown as GithubHookLifecycleService
  return {
    service: new GithubPollSweeperService(
      github,
      reads,
      fanout,
      mailbox,
      inertSignals(),
      hooks,
      localObservations(github),
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
