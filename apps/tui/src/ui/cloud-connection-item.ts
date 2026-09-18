import { EChannelConnection, type ChannelConnection } from '@dltech/atlas-harness'

import type { Span } from './components/spans'
import { EFooterItemReach, type FooterItem } from './footer-item'
import { glyph, spinnerFrame, theme } from './theme'

const spanFor = (state: EChannelConnection, now: number): Span => {
  switch (state) {
    case EChannelConnection.Connecting:
    case EChannelConnection.Reconnecting:
      return { text: spinnerFrame(now), fg: theme.warn }
    case EChannelConnection.Open:
      return { text: '☁', fg: theme.ok }
    case EChannelConnection.Parked:
      return { text: '☾', fg: theme.hint }
    case EChannelConnection.Closed:
      return { text: glyph.failed, fg: theme.warn }
  }
}

export const isAttaching = (state: EChannelConnection): boolean =>
  state === EChannelConnection.Connecting || state === EChannelConnection.Reconnecting

export function cloudConnectionItemOf(args: {
  connection: ChannelConnection | null
  now: number
}): FooterItem | null {
  if (args.connection === null) return null

  return {
    id: 'cloud-connection',
    spans: [spanFor(args.connection.state, args.now)],
    reach: EFooterItemReach.None,
  }
}
