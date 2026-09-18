import React from 'react'

import { EChannelConnection } from '@dltech/atlas-harness'

import type { SidebarCloud } from '../../../store/cloud-state'
import { glyph, theme } from '../../theme'
import type { Span } from '../spans'
import { Row, Section } from './row'

const markFor = (state: EChannelConnection): Span => {
  switch (state) {
    case EChannelConnection.Open:
      return { text: glyph.active, fg: theme.ok }
    case EChannelConnection.Connecting:
    case EChannelConnection.Reconnecting:
      return { text: glyph.active, fg: theme.warn }
    case EChannelConnection.Parked:
      return { text: glyph.available, fg: theme.rule }
    case EChannelConnection.Closed:
      return { text: glyph.failed, fg: theme.warn }
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
