import { EConnectionView, type ConnectionView } from '@dltech/atlas-harness'

import type { Span } from './components/spans'
import { EFooterItemReach, type FooterItem } from './footer-item'
import { glyph, spinnerFrame, theme } from './theme'

const transitionSpans = (args: { label: string; now: number }): readonly Span[] => [
  { text: spinnerFrame(args.now), fg: theme.warn },
  { text: ` ${args.label}`, fg: theme.warn },
]

const spansFor = (state: EConnectionView, now: number): readonly Span[] | null => {
  switch (state) {
    case EConnectionView.Connected:
      return [{ text: '☁', fg: theme.ok }]
    case EConnectionView.Waking:
      return transitionSpans({ label: 'waking', now })
    case EConnectionView.Reconnecting:
      return transitionSpans({ label: 'reconnecting', now })
    case EConnectionView.Updating:
      return transitionSpans({ label: 'updating', now })
    case EConnectionView.Parked:
      return [{ text: '☾', fg: theme.hint }]
    case EConnectionView.Disconnected:
      return [{ text: glyph.failed, fg: theme.warn }]
    case EConnectionView.Detached:
      return null
  }
}

export function cloudConnectionItemOf(args: {
  connection: ConnectionView | null
  now: number
}): FooterItem | null {
  if (args.connection === null) return null

  const spans = spansFor(args.connection.state, args.now)
  if (spans === null) return null

  return { id: 'cloud-connection', spans, reach: EFooterItemReach.None }
}
