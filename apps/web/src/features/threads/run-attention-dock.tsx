'use client'

import {
  RunAttentionStrip,
  type RunAttentionStripProps,
} from '@dltech/atlas-ui/ai/run-attention-strip'

export function RunAttentionDock({ strip }: { strip: RunAttentionStripProps | null }) {
  if (strip === null) return null
  return <RunAttentionStrip {...strip} />
}
