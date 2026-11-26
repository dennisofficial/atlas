import {
  isSessionWorking,
  isTurnRunning,
  stagedPlacementOf,
  transcriptEventsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'
import {
  deriveTranscript,
  overlayStepOf,
  stabilisedBy,
  type TranscriptEntry,
} from '@dltech/atlas-client/transcript'
import type { Attachment } from '@dltech/atlas-core'

import { EMessageAuthor, ERowKind, rowsOf, type ThreadRow } from '../rows'
import { entryFolds } from './registered-plugins'

export type ThreadModel = {
  entries: readonly TranscriptEntry[]
  streaming: boolean
  failure: string | null
}

export type ThreadView = {
  rows: readonly ThreadRow[]
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

export const modelOf = (args: { snapshot: SessionSnapshot }): ThreadModel => {
  const model = deriveTranscript({
    events: transcriptEventsOf(args.snapshot.events),
    signals: [],
    steps: overlayStepOf(args.snapshot.overlay),
    pluginEntries: entryFolds,
  })
  return {
    entries: model.entries,
    streaming: model.streaming,
    failure: model.failure?.message ?? null,
  }
}

export const viewOf = (args: {
  model: ThreadModel
  snapshot: SessionSnapshot
  now: number
  previous?: readonly ThreadRow[] | undefined
}): ThreadView => {
  const turnRunning = isTurnRunning(args.snapshot.status)
  const atByEntry = new Map<string, string>(
    args.snapshot.events.map((event) => [event.id, event.at]),
  )
  const rows = stabilisedBy({
    previous: args.previous ?? [],
    next: rowsOf({
      entries: args.model.entries,
      working: turnRunning,
      now: args.now,
      atOf: (id) => atByEntry.get(id),
    }),
    keyOf: (row) => row.id,
  })
  const lastUser = rows.findLast(
    (row) => row.kind === ERowKind.Message && row.author === EMessageAuthor.You,
  )
  return {
    rows,
    working: isSessionWorking(args.snapshot.status),
    turnRunning,
    streaming: args.model.streaming,
    failure: args.model.failure,
    lastUserRowId: lastUser?.id ?? null,
  }
}
