'use client'

import { useSessionPaneValue } from './pane-value'
import { SessionCrewSection } from './details/crew-section'
import { SessionGithubSection } from './details/github-section'
import { SessionDetailsHeader } from './details/header-section'
import { SessionPodSection } from './details/pod-section'
import { SessionServicesSection } from './details/services-section'
import { SessionShellsSection } from './details/shells-section'
import { SessionSubscriptionsSection } from './details/subscriptions-section'
import { SessionTodoSection } from './details/todo-section'

export function SessionDetailsTab() {
  const { view } = useSessionPaneValue()
  return (
    <div
      data-session-details
      className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-3"
    >
      <SessionDetailsHeader />
      <SessionPodSection />
      <div data-session-todo-slot className="contents">
        <SessionTodoSection tasks={view.plan} />
      </div>
      <SessionGithubSection />
      <SessionSubscriptionsSection />
      <SessionServicesSection />
      <SessionCrewSection />
      <SessionShellsSection />
    </div>
  )
}
