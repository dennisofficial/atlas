import { EPaneVariant } from '../pane-variant'

import { TerminalVariantA } from './terminal-variant-a'
import { TerminalVariantB } from './terminal-variant-b'
import { TerminalVariantC } from './terminal-variant-c'

export function TerminalVariants({ variant }: { variant: EPaneVariant }) {
  if (variant === EPaneVariant.B) return <TerminalVariantB />
  if (variant === EPaneVariant.C) return <TerminalVariantC />
  return <TerminalVariantA />
}
