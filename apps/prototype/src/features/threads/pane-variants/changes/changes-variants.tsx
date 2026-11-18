import { EPaneVariant } from '../pane-variant'
import { VariantA } from './variant-a'
import { VariantB } from './variant-b'
import { VariantC } from './variant-c'

export function ChangesVariants({ variant }: { variant: EPaneVariant }) {
  if (variant === EPaneVariant.B) return <VariantB />
  if (variant === EPaneVariant.C) return <VariantC />
  return <VariantA />
}
