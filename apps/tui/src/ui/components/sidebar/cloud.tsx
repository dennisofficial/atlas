import React from 'react'

import { EChannelConnection } from '@dltech/atlas-harness'

import type { SidebarCloud } from '../../../store/cloud-state'
import { glyph, theme } from '../../theme'
import type { Span } from '../spans'
import { truncateCells } from './cells'
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

const LABEL: Record<EChannelConnection, string> = {
  [EChannelConnection.Connecting]: 'attaching',
  [EChannelConnection.Open]: 'attached',
  [EChannelConnection.Reconnecting]: 'reattaching',
  [EChannelConnection.Parked]: 'asleep until the next message',
  [EChannelConnection.Closed]: 'not answering',
}

export function CloudSection(props: { cloud: SidebarCloud; cells: number }): React.ReactNode {
  const { cloud, cells } = props

  return (
    <Section label="Cloud">
      <Row
        label={cloud.state}
        labelFg={theme.hover}
        cells={cells}
        mark={markFor(cloud.state)}
        value={[{ text: LABEL[cloud.state], fg: theme.hint }]}
      />
      {cloud.detail === null ? null : (
        <text fg={cloud.state === EChannelConnection.Closed ? theme.warn : theme.meta}>
          {truncateCells({ text: cloud.detail, cells })}
        </text>
      )}
    </Section>
  )
}
