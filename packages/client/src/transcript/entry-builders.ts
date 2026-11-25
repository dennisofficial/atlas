import type { Event, RecordEvent } from '@dltech/atlas-core'

import type { TranscriptEntry } from './transcript-model'

/** A plugin's row, keyed by the event that opens it; it reads the whole log because a row may settle later than it opens. */
export type TranscriptEntryFold = (
  events: readonly (Event | RecordEvent)[],
) => ReadonlyMap<string, TranscriptEntry>
