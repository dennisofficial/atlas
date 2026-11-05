import type { SessionChange } from '@dltech/atlas-protocol'

export type ChangeFeed = {
  onChange(listener: (change: SessionChange) => void): () => void
  onGap(listener: () => void): () => void
}
