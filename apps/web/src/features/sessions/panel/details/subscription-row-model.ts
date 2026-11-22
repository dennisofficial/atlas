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

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_HOURS = 24

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

export const subscriptionMetaOf = (args: { row: SubscriptionRow; now: number }): string => {
  const { row, now } = args
  const parts = [
    row.presentation.meta.join(' · '),
    actorLabelOf(row.createdBy),
    expiryTextOf({ expiresAt: row.expiresAt, now }),
  ]
  return parts.filter((part) => part !== null && part.length > 0).join(' · ')
}

export type SubscriptionTitle = { number: string | undefined; text: string }

const NUMBERED_TITLE = /^(#\d+)(?:\s+([\s\S]+))?$/

export const subscriptionTitleOf = (title: string): SubscriptionTitle => {
  const match = NUMBERED_TITLE.exec(title)
  if (match?.[1] === undefined) return { number: undefined, text: title }
  return { number: match[1], text: match[2] ?? '' }
}
