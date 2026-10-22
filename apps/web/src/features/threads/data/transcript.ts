import { BOOT_STEP_EVENT_TYPE, type WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from './events-from-wire'
import { ETranscriptKind, transcriptViewOf, type TranscriptItem } from './transcript-items'

export {
  ETranscriptKind,
  isTextStreaming,
  transcriptViewOf,
  type ThreadTranscriptView,
  type ToolCallItem,
  type TranscriptItem,
} from './transcript-items'

const TITLE_LIMIT = 60

export const coreEventsOf = (events: readonly WireEvent[]): WireEvent[] =>
  events.filter((event) => event.type !== BOOT_STEP_EVENT_TYPE)

export const transcriptOf = (events: readonly WireEvent[]): TranscriptItem[] =>
  transcriptViewOf({ events: eventsFromWire(events), signals: [] }).items.filter(
    (item) => item.kind === ETranscriptKind.User || item.kind === ETranscriptKind.Agent,
  )

export const threadTitleOf = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT)
