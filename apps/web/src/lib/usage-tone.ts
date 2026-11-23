import { EMeterBand } from '@dltech/atlas-core'

export const METER_TONE: Record<EMeterBand, string> = {
  [EMeterBand.Unknown]: 'text-muted-foreground',
  [EMeterBand.Normal]: 'text-foreground',
  [EMeterBand.Warn]: 'text-warning',
  [EMeterBand.Hot]: 'text-destructive',
  [EMeterBand.Red]: 'text-destructive',
  [EMeterBand.Spent]: 'text-destructive',
}

export const METER_BAR: Record<EMeterBand, string> = {
  [EMeterBand.Unknown]: 'bg-muted-foreground',
  [EMeterBand.Normal]: 'bg-foreground',
  [EMeterBand.Warn]: 'bg-warning',
  [EMeterBand.Hot]: 'bg-destructive',
  [EMeterBand.Red]: 'bg-destructive',
  [EMeterBand.Spent]: 'bg-destructive',
}
