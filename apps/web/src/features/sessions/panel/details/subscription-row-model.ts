import { ESubscriptionActor, ESubscriptionTone } from '@dltech/atlas-core'
import { iconNames, type IconName } from 'lucide-react/dynamic'

import type { SubscriptionRow } from '../../data/subscription-rows'

export const SUBSCRIPTION_TONE_CLASS: Record<ESubscriptionTone, string> = {
  [ESubscriptionTone.Neutral]: 'text-muted-foreground',
  [ESubscriptionTone.Open]: 'text-pr-open',
  [ESubscriptionTone.Merged]: 'text-pr-merged',
  [ESubscriptionTone.Closed]: 'text-pr-closed',
  [ESubscriptionTone.Failed]: 'text-destructive',
  [ESubscriptionTone.Running]: 'text-warning',
}

const ACTOR_LABEL: Record<ESubscriptionActor, string> = {
  [ESubscriptionActor.Agent]: 'Agent',
  [ESubscriptionActor.Operator]: 'You',
  [ESubscriptionActor.Provider]: 'Provider',
  [ESubscriptionActor.Clock]: 'Timer',
}

export const actorLabelOf = (actor: ESubscriptionActor): string => ACTOR_LABEL[actor]

export const iconNameOf = (name: string): IconName | undefined =>
  iconNames.find((known) => known === name)

export const subscriptionMetaOf = (row: SubscriptionRow): string =>
  [row.presentation.meta.join(' · '), actorLabelOf(row.createdBy)]
    .filter((part) => part.length > 0)
    .join(' · ')

export type SubscriptionTitle = { number: string | undefined; text: string }

const NUMBERED_TITLE = /^(#\d+)(?:\s+([\s\S]+))?$/

export const subscriptionTitleOf = (title: string): SubscriptionTitle => {
  const match = NUMBERED_TITLE.exec(title)
  if (match?.[1] === undefined) return { number: undefined, text: title }
  return { number: match[1], text: match[2] ?? '' }
}
