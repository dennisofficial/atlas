import { transcriptEventsOf, type SessionSnapshot } from '@dltech/atlas-client/stream'
import {
  EThinkingVisibility,
  overlayStepOf,
  type RevealGate,
} from '@dltech/atlas-client/transcript'

import {
  durableTranscriptOf,
  transcriptViewOf,
  type ThreadTranscriptView,
} from '@/features/threads/data/transcript-items'

export const sessionTranscriptOf = (
  snapshot: Pick<SessionSnapshot, 'events' | 'overlay'> & {
    reveal?: RevealGate | null
  },
): ThreadTranscriptView =>
  transcriptViewOf({
    durable: durableTranscriptOf({
      events: transcriptEventsOf(snapshot.events),
    }),
    live: overlayStepOf(snapshot.overlay),
    thinking: EThinkingVisibility.Keep,
    ...(snapshot.reveal === undefined ? {} : { reveal: snapshot.reveal }),
  })
