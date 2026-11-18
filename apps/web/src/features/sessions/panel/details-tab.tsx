'use client'

import { SessionCrewSection } from './details/crew-section'
import { SessionGithubSection } from './details/github-section'
import { SessionServicesSection } from './details/services-section'
import { SessionShellsSection } from './details/shells-section'
import { SessionSubscriptionsSection } from './details/subscriptions-section'
import { SessionSummarySection } from './details/summary-section'

export function SessionDetailsTab() {
  return (
    <div
      data-session-details
      className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3"
    >
      <SessionSummarySection />
      <SessionGithubSection />
      <SessionServicesSection />
      <SessionShellsSection />
      <SessionCrewSection />
      <SessionSubscriptionsSection />
    </div>
  )
}
