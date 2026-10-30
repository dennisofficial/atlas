import { useMemo } from 'react'

import type { RevealGate } from '@dltech/atlas-client/transcript'

import { transcriptViewOf } from './transcript'
import { useAccountLabel } from './use-account-label'

type ViewArgs = Omit<Parameters<typeof transcriptViewOf>[0], 'accountLabelOf' | 'reveal'> & {
  reveal: RevealGate | null
}

export function useTranscriptView({ durable, live, outputs, reveal }: ViewArgs) {
  const accountLabelOf = useAccountLabel()
  return useMemo(
    () => transcriptViewOf({ durable, live, outputs, reveal, accountLabelOf }),
    [durable, live, outputs, reveal, accountLabelOf],
  )
}
