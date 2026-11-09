import {
  isSessionWorking,
  transcriptEventsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'
import { deriveTranscript, overlayStepOf } from '@dltech/atlas-client/transcript'

import { EMessageAuthor, ERowKind, rowsOf, type ThreadRow } from '../rows'

export type V2ThreadView = {
  rows: ThreadRow[]
  working: boolean
  streaming: boolean
  failure: string | null
  lastUserRowId: string | null
}

export const v2ViewOf = (args: { snapshot: SessionSnapshot; now: number }): V2ThreadView => {
  const working = isSessionWorking(args.snapshot.status)
  const model = deriveTranscript({
    events: transcriptEventsOf(args.snapshot.events),
    signals: [],
    steps: overlayStepOf(args.snapshot.overlay),
    now: () => new Date(args.now),
  })
  const atByEntry = new Map<string, string>(
    args.snapshot.events.map((event) => [event.id, event.at]),
  )
  const rows = rowsOf({
    entries: model.entries,
    working,
    now: args.now,
    atOf: (id) => atByEntry.get(id),
  })
  const lastUser = rows.findLast(
    (row) => row.kind === ERowKind.Message && row.author === EMessageAuthor.You,
  )
  return {
    rows,
    working,
    streaming: model.streaming,
    failure: model.failure?.message ?? null,
    lastUserRowId: lastUser?.id ?? null,
  }
}
