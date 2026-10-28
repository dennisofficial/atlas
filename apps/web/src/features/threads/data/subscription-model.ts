import {
  ESubscriptionStatusWire,
  PULL_REQUEST_SUBSCRIPTION_PROVIDER,
  type SubscriptionWire,
  type WireThread,
} from '@dltech/atlas-wire/web'

import { linkedPullRequestOf } from '@/features/shell/thread-status'

const GITHUB_PREFIX = 'github.com/'
const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_HOURS = 24

export type PullRequestTarget = { repo: string; number: number; input: string }

const ownerRepoOf = (repo: string): string =>
  repo.startsWith(GITHUB_PREFIX) ? repo.slice(GITHUB_PREFIX.length) : repo

export function pullRequestTargetOf(thread: WireThread | undefined): PullRequestTarget | undefined {
  if (thread === undefined) return undefined
  const linked = linkedPullRequestOf(thread)
  if (linked === undefined) return undefined

  const ownerRepo = ownerRepoOf(linked.repo).toLowerCase()
  return {
    repo: `${GITHUB_PREFIX}${ownerRepo}`,
    number: linked.number,
    input: `${ownerRepo}#${linked.number}`,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function subscriptionForPullRequest(args: {
  subscriptions: readonly SubscriptionWire[]
  target: PullRequestTarget
}): SubscriptionWire | undefined {
  return args.subscriptions.find((subscription) => {
    if (subscription.provider !== PULL_REQUEST_SUBSCRIPTION_PROVIDER) return false
    const { target } = subscription
    return (
      isRecord(target) &&
      typeof target.repo === 'string' &&
      target.repo.toLowerCase() === args.target.repo.toLowerCase() &&
      target.number === args.target.number
    )
  })
}

const PROVIDER_LABEL: Record<string, string> = {
  [PULL_REQUEST_SUBSCRIPTION_PROVIDER]: 'Pull request',
}

const ACTOR_LABEL: Record<string, string> = {
  agent: 'Agent',
  operator: 'You',
  provider: 'Provider',
  clock: 'Timer',
}

export const providerLabelOf = (provider: string): string => PROVIDER_LABEL[provider] ?? provider

export const actorLabelOf = (actor: string): string => ACTOR_LABEL[actor] ?? actor

export function expiryTextOf(args: { expiresAt: string | undefined; now: number }): string | null {
  if (args.expiresAt === undefined) return null
  const remaining = Date.parse(args.expiresAt) - args.now
  if (Number.isNaN(remaining)) return null
  if (remaining <= 0) return 'Expired'

  const minutes = Math.max(1, Math.round(remaining / MINUTE_MS))
  if (minutes < HOUR_MINUTES) return `Expires in ${minutes}m`

  const hours = Math.round(minutes / HOUR_MINUTES)
  if (hours < DAY_HOURS) return `Expires in ${hours}h`

  return `Expires in ${Math.round(hours / DAY_HOURS)}d`
}

export function detailOf(args: { subscription: SubscriptionWire; now: number }): string {
  const { subscription, now } = args
  const parts = [
    providerLabelOf(subscription.provider),
    actorLabelOf(subscription.createdBy),
    subscription.held > 0 ? `${subscription.held} held` : null,
    expiryTextOf({ expiresAt: subscription.expiresAt, now }),
  ]
  return parts.filter((part) => part !== null).join(' · ')
}

export type PullRequestBell = { watching: boolean; busy: boolean; label: string }

export function pullRequestBellOf(args: {
  target: PullRequestTarget | undefined
  subscriptions: readonly SubscriptionWire[]
  busy: ReadonlySet<string>
}): PullRequestBell | undefined {
  const { target } = args
  if (target === undefined) return undefined

  const existing = subscriptionForPullRequest({ subscriptions: args.subscriptions, target })
  const watching = existing?.status === ESubscriptionStatusWire.Active
  return {
    watching,
    busy: args.busy.has(target.input) || (existing !== undefined && args.busy.has(existing.id)),
    label: watching ? 'Stop watching pull request' : 'Watch pull request',
  }
}
