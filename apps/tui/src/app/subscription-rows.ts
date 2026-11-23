import {
  ESubscriptionActor,
  ESubscriptionStatus,
  presentSubscription,
  type SubscriptionPresentation,
} from '@dltech/atlas-core'
import { GITHUB_PROVIDER, githubPresenters, targetOf } from '@dltech/atlas-plugin-github/core'
import type { SessionViewOutput } from '@dltech/atlas-protocol'

import type { Span } from '../ui/components/spans'
import { EFooterItemReach, type FooterItem } from '../ui/footer-item'
import {
  ESidebarPlace,
  type SidebarRowAction,
  type SidebarRowSplit,
  type SidebarSection,
  type SidebarSectionRow,
} from '../ui/sidebar-section'
import { formatClockTime, theme } from '../ui/theme'
import type { PullRequestEntry } from './pull-request'

type Subscription = SessionViewOutput['subscriptions'][number]

type BellCommand =
  | { name: 'subscribe'; provider: string; target: string }
  | { name: 'unsubscribe'; subscriptionId: string }

export const BELL_SUBSCRIBED = '●'

export const BELL_IDLE = '○'

export const subscriptionTo = (args: {
  subscriptions: SessionViewOutput['subscriptions']
  repo: string
  number: number
}): Subscription | null =>
  args.subscriptions.find((subscription) => {
    if (subscription.provider !== GITHUB_PROVIDER) return false
    const target = targetOf(subscription.target)
    return target !== null && target.number === args.number
  }) ?? null

export const bellCommandOf = (args: {
  entry: PullRequestEntry
  subscription: { id: string } | null
}): BellCommand => {
  if (args.subscription === null) {
    return {
      name: 'subscribe',
      provider: GITHUB_PROVIDER,
      target: `${args.entry.repo}#${args.entry.number}`,
    }
  }
  return { name: 'unsubscribe', subscriptionId: args.subscription.id }
}

export const bellItemOf = (args: {
  entry: PullRequestEntry
  subscriptions: SessionViewOutput['subscriptions']
  onActivate: () => void
}): SidebarRowAction | undefined => {
  const existing = subscriptionTo({
    subscriptions: args.subscriptions,
    repo: args.entry.repo,
    number: args.entry.number,
  })
  if (existing === null) {
    return { glyph: BELL_IDLE, fg: theme.meta, onActivate: args.onActivate }
  }
  return { glyph: BELL_SUBSCRIBED, fg: theme.ok, onActivate: args.onActivate }
}

export const bellFooterItemOf = (args: {
  entry: PullRequestEntry
  subscriptions: SessionViewOutput['subscriptions']
  onActivate: () => void
}): FooterItem => {
  const action = bellItemOf(args)
  const subscribed = action?.glyph === BELL_SUBSCRIBED
  return {
    id: 'bell',
    spans: [{ text: subscribed ? BELL_SUBSCRIBED : BELL_IDLE, fg: action?.fg ?? theme.meta }],
    reach: EFooterItemReach.Keyboard,
    onActivate: args.onActivate,
  }
}

const PROVIDER_SHORT_NAMES: Record<string, string> = { [GITHUB_PROVIDER]: 'pr' }

const providerNameOf = (provider: string): string =>
  PROVIDER_SHORT_NAMES[provider] ?? provider.slice(provider.lastIndexOf('.') + 1)

const actorNameOf = (actor: string): string | null => {
  if (actor === ESubscriptionActor.Agent) return 'agent'
  if (actor === ESubscriptionActor.Operator) return 'you'
  return null
}

const presentationOf = (subscription: Subscription): SubscriptionPresentation =>
  presentSubscription({
    input: {
      provider: subscription.provider,
      label: subscription.label,
      target: subscription.target,
      status: ESubscriptionStatus.Active,
      events: subscription.events,
    },
    presenters: githubPresenters,
  })

const splitOf = (subscription: Subscription): SidebarRowSplit => {
  const presentation = presentationOf(subscription)
  const actor = actorNameOf(subscription.createdBy)
  const right: Span[] = []
  if (subscription.expiresAt !== null) {
    const at = formatClockTime(subscription.expiresAt)
    if (at !== '') right.push({ text: `expires ${at}`, fg: theme.meta })
  }
  if (actor !== null)
    right.push({ text: `${right.length === 0 ? '' : ' '}${actor}`, fg: theme.accent })

  return {
    left: [
      {
        text: presentation.title.length === 0 ? subscription.label : presentation.title,
        fg: theme.hover,
      },
      { text: ` ${providerNameOf(subscription.provider)}`, fg: theme.hint },
    ],
    right,
  }
}

export const subscriptionsSectionOf = (args: {
  subscriptions: SessionViewOutput['subscriptions']
  entries: readonly PullRequestEntry[]
  onRemove: (subscription: { id: string }) => void
}): SidebarSection | null => {
  const rows = args.subscriptions
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(
      (subscription): SidebarSectionRow => ({
        id: `subscription-${subscription.id}`,
        spans: splitOf(subscription),
        action: { glyph: '✕', onActivate: () => args.onRemove({ id: subscription.id }) },
      }),
    )
  if (rows.length === 0) return null

  return { id: 'subscriptions', place: ESidebarPlace.Panels, label: 'Subscriptions', rows }
}
