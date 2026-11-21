import { pluginViewOf } from '@dltech/atlas-client/stream'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import {
  ESubscriptionActor,
  ESubscriptionStatus,
  ESubscriptionTone,
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
  number?: number
  expiresAt?: string
  held: number
  presentation: SubscriptionPresentation
}

export const subscriptionRowsOf = (
  views: Readonly<Record<string, unknown>>,
): readonly SubscriptionListRow[] =>
  subscriptionsOfView(views).map((row) => {
    const target = targetOf(row.target)
    return {
      id: row.id,
      provider: row.provider,
      status: row.status,
      createdBy: row.createdBy,
      threadId: row.threadId,
      ...(target === null ? {} : { number: target.number }),
      ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
      held: row.held,
      presentation: row.presentation,
    }
  })

export type PullRequestDetail = {
  number: number
  title?: string | undefined
  state?: string | undefined
}

const PULL_REQUEST_STATE: Readonly<Record<string, { icon: string; tone: ESubscriptionTone }>> = {
  open: { icon: 'git-pull-request', tone: ESubscriptionTone.Open },
  draft: { icon: 'git-pull-request-draft', tone: ESubscriptionTone.Neutral },
  merged: { icon: 'git-merge', tone: ESubscriptionTone.Merged },
  closed: { icon: 'git-pull-request-closed', tone: ESubscriptionTone.Closed },
}

const pullRequestTitleOf = (pullRequest: PullRequestDetail): string =>
  pullRequest.title === undefined || pullRequest.title.length === 0
    ? `#${pullRequest.number}`
    : `#${pullRequest.number} ${pullRequest.title}`

export const withPullRequestDetails = (args: {
  rows: readonly SubscriptionListRow[]
  pullRequests: readonly PullRequestDetail[]
}): readonly SubscriptionListRow[] => {
  const byNumber = new Map(
    args.pullRequests.map((pullRequest) => [pullRequest.number, pullRequest]),
  )
  return args.rows.map((row) => {
    if (row.provider !== GITHUB_PROVIDER || row.number === undefined) return row
    const pullRequest = byNumber.get(row.number)
    if (pullRequest === undefined) return row
    const state =
      pullRequest.state === undefined ? undefined : PULL_REQUEST_STATE[pullRequest.state]
    return {
      ...row,
      presentation: {
        ...row.presentation,
        icon: state === undefined ? row.presentation.icon : state.icon,
        tone: state === undefined ? row.presentation.tone : state.tone,
        title: pullRequestTitleOf(pullRequest),
      },
    }
  })
}

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
