import { vi } from 'bun:test'
import { localObservations } from './github-observation.fixture'
import type { GithubObservationStore } from './github-observation.store'
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
    head: {
      ref: 'dennis/add-the-thing',
      sha: 'abc123',
      repo: { full_name: 'compai/app' },
    },
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
  checksIgnored: 0,
  checksState: null,
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
  checksIgnored: 0,
  checksState: null,
  mergeable: true,
  updatedAt: new Date(),
}

export const CHECK_SUITE_PAYLOAD = {
  check_suite: { head_sha: 'abc123', head_branch: 'dennis/add-the-thing' },
  repository: { full_name: 'compai/app' },
}

export const checkRunPayload = (
  over: Partial<{
    id: number
    name: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
    head_sha: string
  }> = {},
) => ({
  action: 'completed',
  check_run: {
    id: 1,
    name: 'build',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-11-02T04:25:00Z',
    completed_at: '2026-11-02T04:26:00Z',
    head_sha: 'abc123',
    check_suite: { head_branch: 'dennis/add-the-thing' },
    ...over,
  },
  repository: { full_name: 'compai/app' },
})

export const SETTLING_CHECK_RUN_PAYLOAD = checkRunPayload()

export const prepareDelivery = async (): Promise<void> => {
  vi.useRealTimers()
  await ensureUsers(...USERS)
}

export function serviceWith(args: {
  tokens?: Record<string, string>
  observations?: GithubObservationStore
  readPullRequest?: GithubUserReads['readPullRequest']
  readCheckAnnotations?: GithubUserReads['readCheckAnnotations']
}): {
  service: GithubDeliveryService
  fanout: GithubPrFanoutService
  mailbox: GithubPrEventMailboxService
} {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
    readCheckAnnotations: args.readCheckAnnotations ?? (async () => []),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const cipher = {} as SecretCipherService
  const wake = {
    notifyEvent: () => undefined,
  } as unknown as GithubSandboxWakeService
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
      args.observations ?? localObservations(github),
    ),
    fanout,
    mailbox,
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
