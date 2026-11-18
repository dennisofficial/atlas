'use client'

import { DetailsSection } from '@/features/threads/panel/details/section'

import { ShellTails } from '../../session-header'
import { useSessionPaneValue } from '../pane-value'

export function SessionShellsSection() {
  const { view, shellTails } = useSessionPaneValue()
  if (view.shells.running === 0) return null
  return (
    <DetailsSection title="Shells" count={view.shells.running}>
      <ShellTails shells={view.shells} tails={shellTails} />
    </DetailsSection>
  )
}
