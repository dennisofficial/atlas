import { transcriptEventsOf, type SessionSnapshot } from '@dltech/atlas-client/stream'
import {
  EThinkingVisibility,
  overlayStepOf,
  type RevealGate,
} from '@dltech/atlas-client/transcript'

import {
  durableTranscriptOf,
  transcriptViewOf,
  type SessionNameOf,
  type ThreadTranscriptView,
} from '@/features/threads/data/transcript-items'
import { sessionEntryFolds, sessionEventTypes } from '../registered-plugins'

export const sessionTranscriptOf = (
  snapshot: Pick<SessionSnapshot, 'events' | 'overlay'> & {
    reveal?: RevealGate | null
    sessionNameOf?: SessionNameOf | undefined
  },
): ThreadTranscriptView =>
  transcriptViewOf({
    durable: durableTranscriptOf({
      events: transcriptEventsOf(snapshot.events, sessionEventTypes),
      pluginEntries: sessionEntryFolds,
    }),
    live: overlayStepOf(snapshot.overlay),
    thinking: EThinkingVisibility.Keep,
    ...(snapshot.reveal === undefined ? {} : { reveal: snapshot.reveal }),
    ...(snapshot.sessionNameOf === undefined ? {} : { sessionNameOf: snapshot.sessionNameOf }),
  })
