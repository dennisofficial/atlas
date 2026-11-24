import {
  ESubscriptionActor,
  ESubscriptionStatus,
  ESubscriptionTone,
  presentSubscription,
  type JsonValue,
  type SubscriptionPresentation,
} from '@dltech/atlas-core'
import { githubPresenters, targetOf } from '@dltech/atlas-plugin-github/core'
import type { SessionSubscription } from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

type PullRequestLook = Readonly<Record<string, { icon: string; tone: ESubscriptionTone }>>

const PULL_REQUEST_LOOK: PullRequestLook = {
  open: { icon: 'git-pull-request', tone: ESubscriptionTone.Open },
  draft: { icon: 'git-pull-request-draft', tone: ESubscriptionTone.Neutral },
  merged: { icon: 'git-merge', tone: ESubscriptionTone.Merged },
  closed: { icon: 'git-pull-request-closed', tone: ESubscriptionTone.Closed },
}

export type SubscriptionRow = {
  id: string
  createdBy: ESubscriptionActor
  target: JsonValue
  presentation: SubscriptionPresentation
}

type PullRequestDetail = Pick<PullRequestEntry, 'number' | 'title' | 'state'>

const actorOf = (createdBy: string): ESubscriptionActor =>
  Object.values(ESubscriptionActor).find((actor) => actor === createdBy) ?? ESubscriptionActor.Agent

const pullRequestTitleOf = (entry: PullRequestDetail): string =>
  entry.title === undefined || entry.title.length === 0
    ? `#${entry.number}`
    : `#${entry.number} ${entry.title}`

const presentationOf = (subscription: SessionSubscription): SubscriptionPresentation => {
  const presented = presentSubscription({
    input: {
      provider: subscription.provider,
      label: subscription.label,
      target: subscription.target,
      status: ESubscriptionStatus.Active,
      events: subscription.events,
    },
    presenters: githubPresenters,
  })
  if (subscription.label.length === 0) return presented
  return { ...presented, title: subscription.label }
}

const withPullRequest = (args: {
  presentation: SubscriptionPresentation
  entry: PullRequestDetail | undefined
}): SubscriptionPresentation => {
  const { presentation, entry } = args
  if (entry === undefined) return presentation
  const look = entry.state === undefined ? undefined : PULL_REQUEST_LOOK[entry.state]
  return {
    ...presentation,
    icon: look?.icon ?? presentation.icon,
    tone: look?.tone ?? presentation.tone,
    title: pullRequestTitleOf(entry),
  }
}

const rowOf = (args: {
  subscription: SessionSubscription
  pullRequests: readonly PullRequestDetail[]
}): SubscriptionRow => {
  const { subscription, pullRequests } = args
  const target = targetOf(subscription.target)
  const entry =
    target === null
      ? undefined
      : pullRequests.find((pullRequest) => pullRequest.number === target.number)
  return {
    id: subscription.id,
    createdBy: actorOf(subscription.createdBy),
    target: subscription.target,
    presentation: withPullRequest({ presentation: presentationOf(subscription), entry }),
  }
}

export const subscriptionRowsOf = (args: {
  subscriptions: readonly SessionSubscription[]
  pullRequests: readonly PullRequestDetail[]
}): readonly SubscriptionRow[] =>
  args.subscriptions.map((subscription) => rowOf({ subscription, pullRequests: args.pullRequests }))
