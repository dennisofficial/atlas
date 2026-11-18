'use client'

import { DetailsSection } from '@/features/threads/panel/details/section'

import { PreviewLinks } from '../../session-header'
import { useSessionPaneValue } from '../pane-value'

export function SessionServicesSection() {
  const { view } = useSessionPaneValue()
  if (view.previews.length === 0) return null
  return (
    <DetailsSection title="Services" count={view.previews.length}>
      <PreviewLinks previews={view.previews} />
    </DetailsSection>
  )
}
