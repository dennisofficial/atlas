'use client'

import { DetailsSection } from '@/features/threads/panel/details/section'

import { CrewPanel } from '../../crew-panel'
import { useSessionPaneValue } from '../pane-value'

export function SessionCrewSection() {
  const { view } = useSessionPaneValue()
  if (view.crew.total === 0) return null
  return (
    <DetailsSection title="Sub-agents" count={`${view.crew.running}/${view.crew.total}`}>
      <CrewPanel rows={view.crewRows} />
    </DetailsSection>
  )
}
