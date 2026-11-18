'use client'

import { DetailsSection } from '@/features/threads/panel/details/section'

import { useSessionPaneValue } from '../pane-value'

export function SessionSubscriptionsSection() {
  const { view } = useSessionPaneValue()
  if (view.subscriptions.length === 0) return null
  return (
    <DetailsSection title="Subscriptions" count={view.subscriptions.length}>
      <ul data-pane-subscriptions className="flex flex-col gap-1.5">
        {view.subscriptions.map((subscription) => (
          <li key={subscription.url} className="flex min-w-0 items-baseline gap-2">
            <a
              href={subscription.url}
              target="_blank"
              rel="noreferrer"
              title={subscription.label}
              className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
            >
              {subscription.label}
            </a>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              #{subscription.number}
            </span>
          </li>
        ))}
      </ul>
    </DetailsSection>
  )
}
