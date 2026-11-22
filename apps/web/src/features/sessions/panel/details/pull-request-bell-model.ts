import { targetOf } from '@dltech/atlas-plugin-github/core'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import type { SubscriptionRow } from '../../data/subscription-rows'

export const PULL_REQUEST_PROVIDER = 'github.pull-request'

export type BellCommand =
  | { name: 'subscribe'; provider: string; target: string }
  | { name: 'unsubscribe'; subscriptionId: string }

export const subscriptionOf = (args: {
  entry: PullRequestEntry
  rows: readonly SubscriptionRow[]
}): SubscriptionRow | undefined =>
  args.rows.find((row) => targetOf(row.target)?.number === args.entry.number)

export const bellCommandOf = (args: {
  entry: PullRequestEntry
  subscription: SubscriptionRow | undefined
}): BellCommand => {
  if (args.subscription === undefined) {
    return {
      name: 'subscribe',
      provider: PULL_REQUEST_PROVIDER,
      target: `${args.entry.repo}#${args.entry.number}`,
    }
  }
  return { name: 'unsubscribe', subscriptionId: args.subscription.id }
}
