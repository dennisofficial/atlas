import { EPaneVariant } from '../pane-variant'
import { VariantA } from './variant-a'
import { VariantB } from './variant-b'
import { VariantC } from './variant-c'
import { VariantD } from './variant-d'

export function DetailsVariants({ variant }: { variant: EPaneVariant }) {
  if (variant === EPaneVariant.A) return <VariantA />
  if (variant === EPaneVariant.B) return <VariantB />
  if (variant === EPaneVariant.D) return <VariantD />
  return <VariantC />
}
