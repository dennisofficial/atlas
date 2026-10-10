import type { GithubPrStateModel } from '../../../db'
import type { CheckTarget } from './github-pr-state-fields'
import type {
  GithubBranchRouting,
  GithubPrStateDto,
} from './github-realtime.types'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubPushWebhookPayload,
} from './github-webhook.types'

/**
 * A subscription whose heartbeats stopped is still live when it is thread-linked to a sandbox
 * whose lastActivityAt sits inside the park-wake window: the parked sandbox is the wake-routing
 * target, so its rows must survive until the window closes. Unlinked rows (user-session
 * subscribes) keep the bare heartbeat TTL. Liveness is materialized on `GithubSubscription.liveUntil`
 * — the liveness predicate no longer joins CloudSandbox on the hot read paths.
 */
export const PARK_WAKE_WINDOW_MS = 24 * 60 * 60 * 1_000

export function subscriptionLiveWhere(args: { now: Date }): Record<string, unknown> {
  return { liveUntil: { gt: args.now } }
}

/**
 * The materialized liveness ceiling for a subscription: the later of its heartbeat TTL and its
 * linked sandbox's park-wake window. Written on subscribe/heartbeat; the sweeper recomputes it so
 * sandbox activity keeps a parked-linked row live without heartbeats.
 */
export function liveUntilOf(args: { expiresAt: Date; sandboxLastActivityAt: Date | null }): Date {
  if (args.sandboxLastActivityAt === null) return args.expiresAt
  const sandboxCeiling = new Date(args.sandboxLastActivityAt.getTime() + PARK_WAKE_WINDOW_MS)
  return sandboxCeiling > args.expiresAt ? sandboxCeiling : args.expiresAt
}

export function subscriberWhereOf(args: {
  repoFullName: string
  prNumber: number
  routing: GithubBranchRouting
}): Record<string, unknown> {
  const live = subscriptionLiveWhere({ now: new Date() })
  const routing = args.routing
  if (!routing.headRepoMatchesBase || routing.headBranch === '') {
    return {
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      AND: [live],
    }
  }
  return {
    repoFullName: args.repoFullName,
    AND: [live, { OR: [{ prNumber: args.prNumber }, { branch: { equals: routing.headBranch, not: '' } }] }],
  }
}

/**
 * A fork-head PR's head.ref is an unqualified branch name, indistinguishable from a same-repo
 * branch, so branch-routing it would fan out to a same-name branch subscriber on the base repo.
 * GitHub nulls head.repo for a deleted fork, and REST rows written before this column existed
 * are null too — both fall to number-routing only, which errs toward silence, never a leak.
 */
export function branchRoutingOf(args: {
  baseRepoFullName: string
  headBranch: string
  headRepoFullName: string | null
}): GithubBranchRouting {
  return {
    headBranch: args.headBranch,
    headRepoMatchesBase: args.headRepoFullName === args.baseRepoFullName,
  }
}

export function dtoOf(row: GithubPrStateModel): GithubPrStateDto {
  return {
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    title: row.title,
    url: row.url,
    state: row.state,
    headBranch: row.headBranch,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    mergeable: row.mergeable,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function checkTargetOf(args: { event: string; payload: unknown }): CheckTarget | null {
  if (args.event === 'check_suite') {
    const payload = args.payload as GithubCheckSuiteWebhookPayload
    return {
      repoFullName: payload.repository.full_name,
      branch: payload.check_suite.head_branch,
      sha: payload.check_suite.head_sha,
    }
  }
  if (args.event === 'check_run') {
    const payload = args.payload as GithubCheckRunWebhookPayload
    return {
      repoFullName: payload.repository.full_name,
      branch: payload.check_run.check_suite?.head_branch ?? null,
      sha: payload.check_run.head_sha,
    }
  }
  if (args.event === 'push') {
    const payload = args.payload as GithubPushWebhookPayload
    const branch = payload.ref.replace(/^refs\/heads\//, '')
    if (branch === payload.ref) return null
    return { repoFullName: payload.repository.full_name, branch, sha: null }
  }
  return null
}
