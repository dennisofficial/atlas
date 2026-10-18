import React from 'react'

import { EConnectionView } from '@dltech/atlas-harness'

import type { SidebarCloud } from '../../../store/cloud-state'
import { glyph, theme } from '../../theme'
import type { Span } from '../spans'
import { Row, Section } from './row'

export const markFor = (state: EConnectionView): Span => {
  switch (state) {
    case EConnectionView.Connected:
      return { text: glyph.active, fg: theme.ok }
    case EConnectionView.Waking:
    case EConnectionView.Reconnecting:
    case EConnectionView.Updating:
      return { text: glyph.active, fg: theme.warn }
    case EConnectionView.Parked:
      return { text: glyph.available, fg: theme.rule }
    case EConnectionView.Disconnected:
      return { text: glyph.failed, fg: theme.warn }
    case EConnectionView.Detached:
      return { text: glyph.failed, fg: theme.rule }
  }
}

export function CloudSection(props: { cloud: SidebarCloud; cells: number }): React.ReactNode {
  const { cloud, cells } = props

  return (
    <Section label="Cloud">
      <Row label={cloud.state} labelFg={theme.hover} cells={cells} mark={markFor(cloud.state)} />
    </Section>
  )
}
