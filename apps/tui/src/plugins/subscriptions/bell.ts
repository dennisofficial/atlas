import { ESubscriptionStatus } from '@dltech/atlas-core'
import {
  PULL_REQUEST_PROVIDER_KIND,
  pullRequestTargetOf,
  type SubscriptionView,
} from '@dltech/atlas-harness'

import type { SidebarRowAction } from '../../ui/sidebar-section'
import { theme } from '../../ui/theme'

export const BELL_SUBSCRIBED = '●'

export const BELL_IDLE = '○'

export const subscriptionTo = (args: {
  views: readonly SubscriptionView[]
  repo: string
  number: number
}): SubscriptionView | null =>
  args.views.find((view) => {
    if (view.provider !== PULL_REQUEST_PROVIDER_KIND) return false
    const target = pullRequestTargetOf(view.target)
    return (
      target !== null &&
      target.repo.toLowerCase() === args.repo.toLowerCase() &&
      target.number === args.number
    )
  }) ?? null

export function bellFor(args: {
  views: readonly SubscriptionView[]
  repo: string
  number: number
  ring: (existing: SubscriptionView | null) => void
}): SidebarRowAction | undefined {
  if (pullRequestTargetOf({ repo: args.repo, number: args.number }) === null) return undefined

  const existing = subscriptionTo(args)
  if (existing === null) {
    return { glyph: BELL_IDLE, fg: theme.meta, onActivate: () => args.ring(null) }
  }

  return {
    glyph: BELL_SUBSCRIBED,
    fg: existing.status === ESubscriptionStatus.Paused ? theme.warn : theme.ok,
    onActivate: () => args.ring(existing),
  }
}
