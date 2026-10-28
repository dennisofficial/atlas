import { ESubscriptionActor, ESubscriptionStatus, type ThreadId } from '@dltech/atlas-core'
import { PULL_REQUEST_PROVIDER_KIND, type SubscriptionView } from '@dltech/atlas-harness'

import type { Span } from '../../ui/components/spans'
import {
  ESidebarPlace,
  type SidebarRowSplit,
  type SidebarSection,
  type SidebarSectionRow,
} from '../../ui/sidebar-section'
import { formatClockTime, theme } from '../../ui/theme'

export const SUBSCRIPTIONS_SECTION_ID = 'subscriptions'

export const SUBSCRIPTIONS_HEADING = 'Subscriptions'

export const REMOVE_GLYPH = '✕'

const PROVIDER_SHORT_NAMES: Record<string, string> = { [PULL_REQUEST_PROVIDER_KIND]: 'pr' }

const providerName = (kind: string): string =>
  PROVIDER_SHORT_NAMES[kind] ?? kind.slice(kind.lastIndexOf('.') + 1)

const actorName = (actor: ESubscriptionActor): string | null => {
  if (actor === ESubscriptionActor.Agent) return 'agent'
  if (actor === ESubscriptionActor.Operator) return 'you'
  return null
}

export function statusText(view: SubscriptionView): string {
  const parts: string[] = []
  if (view.status === ESubscriptionStatus.Paused) parts.push('paused')
  if (view.held > 0) parts.push(`${view.held} held`)
  if (view.expiresAt !== undefined) {
    const at = formatClockTime(view.expiresAt)
    if (at !== '') parts.push(`expires ${at}`)
  }
  return parts.join(', ')
}

const splitOf = (view: SubscriptionView): SidebarRowSplit => {
  const paused = view.status === ESubscriptionStatus.Paused
  const status = statusText(view)
  const actor = actorName(view.createdBy)
  const right: Span[] = []
  if (status !== '') right.push({ text: status, fg: paused ? theme.warn : theme.meta })
  if (actor !== null) right.push({ text: `${status === '' ? '' : ' '}${actor}`, fg: theme.accent })

  return {
    left: [
      { text: view.label, fg: paused ? theme.hint : theme.hover },
      { text: ` ${providerName(view.provider)}`, fg: theme.hint },
    ],
    right,
  }
}

export function subscriptionsSection(args: {
  views: readonly SubscriptionView[]
  threadId: ThreadId
  onToggle: (view: SubscriptionView) => void
  onRemove: (view: SubscriptionView) => void
}): SidebarSection | null {
  const rows = args.views
    .filter((view) => view.threadId === args.threadId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(
      (view): SidebarSectionRow => ({
        id: `subscription-${view.id}`,
        spans: splitOf(view),
        onActivate: () => args.onToggle(view),
        action: { glyph: REMOVE_GLYPH, onActivate: () => args.onRemove(view) },
      }),
    )
  if (rows.length === 0) return null

  return {
    id: SUBSCRIPTIONS_SECTION_ID,
    place: ESidebarPlace.Panels,
    label: SUBSCRIPTIONS_HEADING,
    rows,
  }
}
