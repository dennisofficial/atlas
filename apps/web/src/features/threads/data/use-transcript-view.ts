import { useMemo } from 'react'

import type { RevealGate } from '@dltech/atlas-client/transcript'

import { transcriptViewOf } from './transcript'

type ViewArgs = Omit<Parameters<typeof transcriptViewOf>[0], 'reveal'> & {
  reveal: RevealGate | null
}

export function useTranscriptView({ durable, live, outputs, reveal }: ViewArgs) {
  return useMemo(
    () => transcriptViewOf({ durable, live, outputs, reveal }),
    [durable, live, outputs, reveal],
  )
}
