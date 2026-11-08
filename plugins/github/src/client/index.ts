import { pluginViewOf } from '@dltech/atlas-client/stream'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { ESubscriptionStatus } from '@dltech/atlas-core'

import {
  GITHUB_PROVIDER,
  labelOf,
  SUBSCRIPTIONS_VIEW,
  subscriptionsViewSchema,
  targetOf,
  type SubscriptionRow,
} from '../core'

export const githubClient: ClientSlot = {
  hooks: [
    {
      name: 'github-subscriptions',
      appliesTo: (event) => event.type.startsWith('subscription-'),
    },
  ],
}

export const subscriptionsOfView = (
  views: Readonly<Record<string, unknown>>,
): readonly SubscriptionRow[] =>
  pluginViewOf({
    views,
    name: SUBSCRIPTIONS_VIEW,
    schema: subscriptionsViewSchema,
  }) ?? []

export type SubscribedPullRequest = {
  number: number
  label: string
  url: string
}

export const subscribedPullRequestsOf = (
  views: Readonly<Record<string, unknown>>,
): readonly SubscribedPullRequest[] =>
  subscriptionsOfView(views).flatMap((row) => {
    if (row.provider !== GITHUB_PROVIDER || row.status !== ESubscriptionStatus.Active) return []
    const target = targetOf(row.target)
    if (target === null) return []
    return [
      {
        number: target.number,
        label: labelOf(target),
        url: `https://${target.repo}/pull/${target.number}`,
      },
    ]
  })
