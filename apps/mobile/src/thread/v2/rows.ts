import {
  isSessionWorking,
  isTurnRunning,
  stagedPlacementOf,
  transcriptEventsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'
import { deriveTranscript, overlayStepOf } from '@dltech/atlas-client/transcript'
import type { Attachment } from '@dltech/atlas-core'

import { EMessageAuthor, ERowKind, rowsOf, type ThreadRow } from '../rows'
import { v2EntryFolds } from './registered-plugins'

export type V2ThreadView = {
  rows: ThreadRow[]
  working: boolean
  turnRunning: boolean
  streaming: boolean
  failure: string | null
  lastUserRowId: string | null
}

const stagedRowOf = (entry: {
  clientId: string
  text: string
  attachments: readonly Attachment[]
}): ThreadRow => ({
  kind: ERowKind.Message,
  id: entry.clientId,
  author: EMessageAuthor.You,
  at: undefined,
  text: entry.text,
  streaming: false,
  steer: false,
  attachments: [...entry.attachments],
  staged: true,
})

const stagedSplitOf = (args: {
  snapshot: SessionSnapshot
  staged: readonly { clientId: string; text: string; attachments: readonly Attachment[] }[]
}) =>
  stagedPlacementOf({
    staged: args.staged,
    events: args.snapshot.events,
    working: isSessionWorking(args.snapshot.status),
  })

export const stagedRowsOf = (args: {
  snapshot: SessionSnapshot
  staged: readonly { clientId: string; text: string; attachments: readonly Attachment[] }[]
  now: number
}): ThreadRow[] => stagedSplitOf(args).transcript.map(stagedRowOf)

export const v2ViewOf = (args: { snapshot: SessionSnapshot; now: number }): V2ThreadView => {
  const turnRunning = isTurnRunning(args.snapshot.status)
  const model = deriveTranscript({
    events: transcriptEventsOf(args.snapshot.events),
    signals: [],
    steps: overlayStepOf(args.snapshot.overlay),
    pluginEntries: v2EntryFolds,
    now: () => new Date(args.now),
  })
  const atByEntry = new Map<string, string>(
    args.snapshot.events.map((event) => [event.id, event.at]),
  )
  const rows = rowsOf({
    entries: model.entries,
    working: turnRunning,
    now: args.now,
    atOf: (id) => atByEntry.get(id),
  })
  const lastUser = rows.findLast(
    (row) => row.kind === ERowKind.Message && row.author === EMessageAuthor.You,
  )
  return {
    rows,
    working: isSessionWorking(args.snapshot.status),
    turnRunning,
    streaming: model.streaming,
    failure: model.failure?.message ?? null,
    lastUserRowId: lastUser?.id ?? null,
  }
}
