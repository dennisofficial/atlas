import { vi } from 'bun:test'
import { localCoordinator } from './github-request-coordinator.fixture'
import type { GithubRequestCoordinator } from './github-request-coordinator'
import {
  ensureUsers,
  seedRepoHook,
  seedSubscription as seedSubscriptionRow,
} from '../../../../test/github-seed'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { inertReconcile } from './github-pr-store.fixture'
import { GithubPrMergeabilityRefresh } from './github-pr-mergeability-refresh'
import { GithubPrStore } from './github-pr-store'
import { GithubFillTokens } from './github-fill-token'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubDeliveryService } from './github-delivery.service'
import { observationReadOf } from './github-pr-read.fixture'
import type { GithubInstallationTokens } from './github-installation-tokens'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import { type CommitCheckInput, restCommitChecksOf } from './github-commit-checks'
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
    closed_at: null,
    updated_at: '2026-11-18T00:00:00Z',
    mergeable: null,
    mergeable_state: 'unknown',
    base: { ref: 'main', repo: { full_name: 'compai/app' } },
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
  mergeable: true,
  mergeClean: true,
}

export const passedCheckInputs = (count: number): CommitCheckInput[] =>
  restCommitChecksOf({
    checkRuns: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      name: `job-${index + 1}`,
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-11-02T04:25:00Z',
      completed_at: '2026-11-02T04:26:00Z',
    })),
    statuses: [],
  })

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
  baseBranch: 'main',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  checksIgnored: 0,
  checksState: null,
  mergeable: true,
  mergeableHeadSha: 'abc123',
  mergeableBaseRef: 'main',
  mergeableObservedAt: new Date('2026-11-17T00:00:00Z'),
  pullUpdatedAt: new Date('2026-11-17T00:00:00Z'),
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

const withBaseBranch =
  (read: GithubUserReads['readPullRequest']): GithubUserReads['readPullRequest'] =>
  async (args) => {
    let collected = false
    const fields = await read({
      ...args,
      collectRequiredContexts: (held) => {
        collected = true
        args.collectRequiredContexts?.(held)
      },
    })
    if (!collected) {
      args.collectRequiredContexts?.({
        acquiredAt: new Date(),
        baseBranch: 'main',
        requiredContexts: [],
      })
    }

    return fields
  }

export const prepareDelivery = async (): Promise<void> => {
  vi.useRealTimers()
  await ensureUsers(...USERS)
}

export function serviceWith(args: {
  tokens?: Record<string, string>
  coordinator?: GithubRequestCoordinator
  appTokens?: GithubInstallationTokens
  readPullRequest?: GithubUserReads['readPullRequest']
  readCheckAnnotations?: GithubUserReads['readCheckAnnotations']
}): {
  service: GithubDeliveryService
  fanout: GithubPrFanoutService
  mailbox: GithubPrEventMailboxService
  dispatcher: GithubPrOutboxDispatcher
} {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const readPullRequest = withBaseBranch(args.readPullRequest ?? (async () => REST_FIELDS))
  const reads = {
    readPullRequest,
    readPullRequestObservation: async (input: { number: number }) =>
      observationReadOf({ fields: await readPullRequest(input as never), number: input.number }),
    readCheckAnnotations: args.readCheckAnnotations ?? (async () => []),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const cipher = {} as SecretCipherService
  const wake = {
    notifyEvent: () => undefined,
  } as unknown as GithubSandboxWakeService
  const budget = args.coordinator ?? localCoordinator(github)
  const fillTokens = new GithubFillTokens({ github, appTokens: args.appTokens })
  let store: GithubPrStore
  const mergeability = new GithubPrMergeabilityRefresh({
    store: () => store,
    fillTokenOf: (request) => fillTokens.find(request),
    reads,
    budget,
  })
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout,
    signals: inertSignals(),
    wake,
    reconcile: inertReconcile(),
    mergeability: (run) => mergeability.run(run),
  })
  const mailbox = new GithubPrEventMailboxService(fanout, dispatcher)
  store = new GithubPrStore({ mailbox, dispatcher })
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
      budget,
      store,
      args.appTokens,
    ),
    fanout,
    mailbox,
    dispatcher,
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
