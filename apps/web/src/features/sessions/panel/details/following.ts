import type { SubscribedPullRequest } from '@dltech/atlas-plugin-github/client'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

export const PULL_REQUEST_PROVIDER = 'github.pull-request'

export type FollowingCommand =
  | { name: 'subscribe'; args: { provider: string; target: string } }
  | { name: 'unsubscribe'; args: { subscriptionId: string } }

const covers = (args: {
  entry: PullRequestEntry
  subscriptions: readonly SubscribedPullRequest[]
}): boolean => args.subscriptions.some((subscription) => subscription.number === args.entry.number)

export const followingOf = (args: {
  entries: readonly PullRequestEntry[]
  subscriptions: readonly SubscribedPullRequest[]
}): boolean => args.entries.length > 0 && args.entries.every((entry) => covers({ entry, ...args }))

export const followingCommandsOf = (args: {
  entries: readonly PullRequestEntry[]
  subscriptions: readonly SubscribedPullRequest[]
  following: boolean
}): readonly FollowingCommand[] => {
  if (!args.following) {
    return args.subscriptions.flatMap((subscription) =>
      subscription.id === undefined ||
      !args.entries.some((entry) => entry.number === subscription.number)
        ? []
        : [{ name: 'unsubscribe' as const, args: { subscriptionId: subscription.id } }],
    )
  }
  return args.entries
    .filter((entry) => !covers({ entry, subscriptions: args.subscriptions }))
    .map((entry) => ({
      name: 'subscribe' as const,
      args: { provider: PULL_REQUEST_PROVIDER, target: `${entry.repo}#${entry.number}` },
    }))
}
