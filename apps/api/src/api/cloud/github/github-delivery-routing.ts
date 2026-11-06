import { and, or, type Row } from '@dltech/atlas-db'
import { normalizedRepo, repoPattern } from './github-pr-identity'
import type { GithubBranchRouting, GithubPrStateDto } from './github-realtime.types'

/**
 * A subscription whose heartbeats stopped is still live when it is thread-linked to a sandbox
 * whose lastActivityAt sits inside the park-wake window: the parked sandbox is the wake-routing
 * target, so its rows must survive until the window closes. Unlinked rows (user-session
 * subscribes) keep the bare heartbeat TTL. Liveness is materialized on `GithubSubscription.liveUntil`
 * — the liveness predicate no longer joins CloudSandbox on the hot read paths.
 */
export const PARK_WAKE_WINDOW_MS = 24 * 60 * 60 * 1_000
const SUBSCRIPTION_TTL_MS = 5 * 60 * 1_000
export const nextExpiry = () => new Date(Date.now() + SUBSCRIPTION_TTL_MS)

type Condition = Parameters<typeof and>[number]

type LiveFields = { liveUntil: { gt(value: Date): Condition } }

type SubscriberFields = LiveFields & {
  repoFullName: { ilike(value: string): Condition }
  prNumber: { eq(value: number): Condition }
  branch: { eq(value: string): Condition; neq(value: string): Condition }
}

export function subscriptionLiveWhere(args: {
  now: Date
}): (subscription: LiveFields) => Condition {
  return (subscription) => subscription.liveUntil.gt(args.now)
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
}): (subscription: SubscriberFields) => Condition {
  const live = subscriptionLiveWhere({ now: new Date() })
  const routing = args.routing
  if (!routing.headRepoMatchesBase || routing.headBranch === '') {
    return (subscription) =>
      and(
        subscription.repoFullName.ilike(repoPattern(args.repoFullName)),
        subscription.prNumber.eq(args.prNumber),
        live(subscription),
      )
  }
  return (subscription) =>
    and(
      subscription.repoFullName.ilike(repoPattern(args.repoFullName)),
      live(subscription),
      or(
        subscription.prNumber.eq(args.prNumber),
        and(subscription.branch.eq(routing.headBranch), subscription.branch.neq('')),
      ),
    )
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
    headRepoMatchesBase:
      args.headRepoFullName !== null &&
      normalizedRepo(args.headRepoFullName) === normalizedRepo(args.baseRepoFullName),
  }
}

export function dtoOf(row: Row<'GithubPrState'>): GithubPrStateDto {
  return {
    repoFullName: normalizedRepo(row.repoFullName),
    prNumber: row.prNumber,
    title: row.title,
    url: row.url,
    state: row.state,
    headBranch: row.headBranch,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    checksIgnored: row.checksIgnored,
    mergeable: row.mergeable,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  }
}
