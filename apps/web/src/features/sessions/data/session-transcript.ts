import { transcriptEventsOf, type SessionSnapshot } from '@dltech/atlas-client/stream'
import { overlayStepOf } from '@dltech/atlas-client/transcript'

import {
  durableTranscriptOf,
  transcriptViewOf,
  type ThreadTranscriptView,
} from '@/features/threads/data/transcript-items'

export const sessionTranscriptOf = (
  snapshot: Pick<SessionSnapshot, 'events' | 'overlay'>,
): ThreadTranscriptView =>
  transcriptViewOf({
    durable: durableTranscriptOf({ events: transcriptEventsOf(snapshot.events) }),
    live: overlayStepOf(snapshot.overlay),
  })
