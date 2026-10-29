import { vi } from 'bun:test'
import {
  ensureUsers,
  seedRepoHook,
  seedSubscription as seedSubscriptionRow,
} from '../../../../test/github-seed'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import type { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

export const PULL_REQUEST_PAYLOAD = {
  action: 'opened',
  pull_request: {
    number: 42,
    title: 'add the thing',
    html_url: 'https://github.com/compai/app/pull/42',
    state: 'open',
    draft: false,
    merged_at: null,
    head: { ref: 'dennis/add-the-thing', sha: 'abc123', repo: { full_name: 'compai/app' } },
  },
  repository: { full_name: 'compai/app' },
}

export const REST_FIELDS: PullRequestCacheFields = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
}

const USERS = [
  'usr-creator',
  'usr-gone',
  'usr-sub',
  'usr-a',
  'usr-b',
  'usr-c',
  'usr-branch',
  'usr-other',
  'usr-number',
  'usr-fast',
  'usr-settled',
  'usr-parked',
  'usr-stale',
]

export const FILLED_PR_STATE = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
  updatedAt: new Date(),
}

export const CHECK_SUITE_PAYLOAD = {
  check_suite: { head_sha: 'abc123', head_branch: 'dennis/add-the-thing' },
  repository: { full_name: 'compai/app' },
}

export const prepareDelivery = async (): Promise<void> => {
  vi.useRealTimers()
  await ensureUsers(...USERS)
}

export function serviceWith(args: {
  tokens?: Record<string, string>
  readPullRequest?: GithubUserReads['readPullRequest']
}): { service: GithubDeliveryService; fanout: GithubPrFanoutService } {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const cipher = {} as SecretCipherService
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  const mailbox = new GithubPrEventMailboxService(fanout, wake)
  const discussion = new GithubPrDiscussionDeliveryService(mailbox)
  return {
    service: new GithubDeliveryService(
      github,
      reads,
      fanout,
      cipher,
      mailbox,
      discussion,
      inertSignals(),
    ),
    fanout,
  }
}

export const seedHook = (args: { createdBy: string }) => seedRepoHook({ createdBy: args.createdBy })

export function seedSubscription(args: {
  userId: string
  prNumber: number | null
  branch?: string
}): Promise<unknown> {
  return seedSubscriptionRow({
    id: `sub-${args.userId}-${args.prNumber ?? args.branch}`,
    userId: args.userId,
    prNumber: args.prNumber,
    branch: args.branch ?? `#${args.prNumber}`,
  })
}
