import { EPaneVariant } from '../pane-variant'

import { TerminalVariantA } from './terminal-variant-a'
import { TerminalVariantB } from './terminal-variant-b'
import { TerminalVariantC } from './terminal-variant-c'
import { TerminalVariantD } from './terminal-variant-d'

export function TerminalVariants({ variant }: { variant: EPaneVariant }) {
  if (variant === EPaneVariant.B) return <TerminalVariantB />
  if (variant === EPaneVariant.C) return <TerminalVariantC />
  if (variant === EPaneVariant.D) return <TerminalVariantD />
  return <TerminalVariantA />
}
