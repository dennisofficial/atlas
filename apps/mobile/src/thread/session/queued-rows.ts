import { deriveTranscript } from '@dltech/atlas-client/transcript'
import {
  ENoticeStage,
  isMessageInputKind,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
  userSaidOf,
  type Event,
  type EventBody,
  type EventEnvelope,
  type PendingInput,
  type PendingInputsState,
} from '@dltech/atlas-core'

import { rowsOf, type ThreadRow } from '../rows'
import { entryFolds } from './registered-plugins'
import type { StagedSend } from './staged-send'

export type QueuedRow = { id: string; row: ThreadRow }

const QUEUED_ID = 'queued'

const rowIdOf = (inboxId: number): string => `queued-${inboxId}`

const messageRowIdOf = (input: PendingInput): string =>
  input.message?.clientId ?? rowIdOf(input.inboxId)

const envelopeOf = (args: {
  id: string
  seq: number
  at: string
  events: readonly Event[]
}): EventEnvelope => {
  const last = args.events.at(-1)
  return {
    id: toEventId(args.id),
    seq: args.seq,
    threadId: last?.threadId ?? toThreadId(QUEUED_ID),
    runId: last?.runId ?? toRunId(QUEUED_ID),
    depth: last?.depth ?? 0,
    at: args.at,
  }
}

const stampedInputOf = (args: {
  input: PendingInput
  events: readonly Event[]
}): { id: string; event: Event } | null => {
  const { input } = args
  if (isMessageInputKind(input.kind)) {
    if (input.message === undefined) return null
    const id = messageRowIdOf(input)
    return {
      id,
      event: stampEvent({
        draft: userSaidOf({ inboxId: input.inboxId, message: input.message }),
        envelope: envelopeOf({ id, seq: input.seq, at: input.at, events: args.events }),
      }),
    }
  }
  const body = input.event
  if (body === undefined) return null
  const id = rowIdOf(input.inboxId)
  return {
    id,
    event: stampEvent({
      draft: { ...body, notice: { id, stage: ENoticeStage.Delivered } },
      envelope: envelopeOf({ id, seq: input.seq, at: input.at, events: args.events }),
    }),
  }
}

const stagedBodyOf = (staged: StagedSend): EventBody => ({
  type: 'user-said',
  text: staged.text,
  clientId: staged.clientId,
  ...(staged.attachments.length === 0 ? {} : { attachments: staged.attachments }),
})

const rowOfEvent = (args: { event: Event; now: number }): ThreadRow | null => {
  const model = deriveTranscript({
    events: [args.event],
    signals: [],
    pluginEntries: entryFolds,
    now: () => new Date(args.now),
  })
  const rows = rowsOf({
    entries: model.entries,
    working: false,
    now: args.now,
    atOf: () => args.event.at,
  })
  return rows.at(-1) ?? null
}

const pendingRowsOf = (args: {
  pending: PendingInputsState
  events: readonly Event[]
  now: number
}): QueuedRow[] =>
  args.pending.pending.flatMap((input) => {
    const stamped = stampedInputOf({ input, events: args.events })
    if (stamped === null) return []
    const row = rowOfEvent({ event: stamped.event, now: args.now })
    return row === null ? [] : [{ id: stamped.id, row }]
  })

const stagedRowsOf = (args: {
  staged: readonly StagedSend[]
  events: readonly Event[]
  now: number
}): QueuedRow[] =>
  args.staged.flatMap((staged) => {
    const at = new Date(args.now).toISOString()
    const event = stampEvent({
      draft: stagedBodyOf(staged),
      envelope: envelopeOf({ id: staged.clientId, seq: 0, at, events: args.events }),
    })
    const row = rowOfEvent({ event, now: args.now })
    return row === null ? [] : [{ id: staged.clientId, row }]
  })

export const queuedRowsOf = (args: {
  pending: PendingInputsState
  events: readonly Event[]
  staged: readonly StagedSend[]
  now: number
}): QueuedRow[] => [
  ...pendingRowsOf({ pending: args.pending, events: args.events, now: args.now }),
  ...stagedRowsOf({ staged: args.staged, events: args.events, now: args.now }),
]
