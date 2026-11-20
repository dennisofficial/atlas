import { pluginViewOf } from '@dltech/atlas-client/stream'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import {
  ESubscriptionActor,
  ESubscriptionStatus,
  type SubscriptionPresentation,
} from '@dltech/atlas-core'

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

export type SubscriptionListRow = {
  id: string
  provider: string
  status: ESubscriptionStatus
  createdBy: ESubscriptionActor
  threadId: string
  expiresAt?: string
  held: number
  presentation: SubscriptionPresentation
}

export const subscriptionRowsOf = (
  views: Readonly<Record<string, unknown>>,
): readonly SubscriptionListRow[] =>
  subscriptionsOfView(views).map((row) => ({
    id: row.id,
    provider: row.provider,
    status: row.status,
    createdBy: row.createdBy,
    threadId: row.threadId,
    ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
    held: row.held,
    presentation: row.presentation,
  }))

export type SubscribedPullRequest = {
  id: string
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
        id: row.id,
        number: target.number,
        label: labelOf(target),
        url: `https://${target.repo}/pull/${target.number}`,
      },
    ]
  })
