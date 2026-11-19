import type { SubscribedPullRequest } from '@dltech/atlas-plugin-github/client'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

export const PULL_REQUEST_PROVIDER = 'github.pull-request'

export type BellCommand =
  | { name: 'subscribe'; args: { provider: string; target: string } }
  | { name: 'unsubscribe'; args: { subscriptionId: string } }

export const subscriptionOf = (args: {
  entry: PullRequestEntry
  subscriptions: readonly SubscribedPullRequest[]
}): SubscribedPullRequest | undefined =>
  args.subscriptions.find((subscription) => subscription.number === args.entry.number)

export const bellCommandOf = (args: {
  entry: PullRequestEntry
  subscription: SubscribedPullRequest | undefined
}): BellCommand | null => {
  if (args.subscription === undefined) {
    return {
      name: 'subscribe',
      args: { provider: PULL_REQUEST_PROVIDER, target: `${args.entry.repo}#${args.entry.number}` },
    }
  }
  if (args.subscription.id === undefined) return null
  return { name: 'unsubscribe', args: { subscriptionId: args.subscription.id } }
}
