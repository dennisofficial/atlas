import {
  ESubscriptionStatusWire,
  PULL_REQUEST_SUBSCRIPTION_PROVIDER,
  type SubscriptionWire,
  type WireThread,
} from '@dltech/atlas-wire/web'

import {
  pinnedPullRequestOf,
  pullRequestEntriesOf,
  pullRequestKeyOf,
  type PullRequestEntry,
} from './pull-request-entries'

const GITHUB_PREFIX = 'github.com/'

export type PullRequestTarget = { repo: string; number: number; input: string }

const ownerRepoOf = (repo: string): string =>
  repo.startsWith(GITHUB_PREFIX) ? repo.slice(GITHUB_PREFIX.length) : repo

export function pullRequestTargetOfEntry(entry: PullRequestEntry): PullRequestTarget {
  const ownerRepo = ownerRepoOf(entry.repo).toLowerCase()
  return {
    repo: `${GITHUB_PREFIX}${ownerRepo}`,
    number: entry.number,
    input: `${ownerRepo}#${entry.number}`,
  }
}

export function pullRequestTargetOf(thread: WireThread | undefined): PullRequestTarget | undefined {
  if (thread === undefined) return undefined
  const pinned = pinnedPullRequestOf(pullRequestEntriesOf({ thread, states: [] }))
  return pinned === undefined ? undefined : pullRequestTargetOfEntry(pinned)
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

export function detailOf(subscription: SubscriptionWire): string {
  const parts = [
    providerLabelOf(subscription.provider),
    actorLabelOf(subscription.createdBy),
    subscription.held > 0 ? `${subscription.held} held` : null,
  ]
  return parts.filter((part) => part !== null).join(', ')
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

export function pullRequestBellsOf(args: {
  entries: readonly PullRequestEntry[]
  subscriptions: readonly SubscriptionWire[]
  busy: ReadonlySet<string>
}): Record<string, PullRequestBell> {
  const bells: Record<string, PullRequestBell> = {}
  for (const entry of args.entries) {
    const bell = pullRequestBellOf({
      target: pullRequestTargetOfEntry(entry),
      subscriptions: args.subscriptions,
      busy: args.busy,
    })
    if (bell !== undefined) bells[pullRequestKeyOf(entry)] = bell
  }
  return bells
}
