import { transcriptEventsOf, type SessionSnapshot } from '@dltech/atlas-client/stream'
import { overlayStepOf, type RevealGate } from '@dltech/atlas-client/transcript'
import { useMemo } from 'react'

import { useReveal } from '@/features/threads/data/use-reveal'

export function useSessionReveal(
  snapshot: Pick<SessionSnapshot, 'events' | 'overlay'>,
): RevealGate | null {
  const steps = useMemo(() => overlayStepOf(snapshot.overlay), [snapshot.overlay])
  const events = useMemo(() => transcriptEventsOf(snapshot.events), [snapshot.events])
  return useReveal({ steps, events })
}
