import {
  EMessageOrigin,
  ENoticeStage,
  isMessageInputKind,
  saidBy,
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

import { reportItemsOf } from '@/features/threads/data/transcript-agents'
import {
  durableTranscriptOf,
  ETranscriptKind,
  transcriptViewOf,
  type SessionNameOf,
  type TranscriptRow,
} from '@/features/threads/data/transcript-items'
import { ETurnKind, turnsOf, type Turn } from '@/features/threads/data/transcript-turns'

import type { StagedMessage } from './queued-messages'

export type QueuedWithdraw = { inboxId: string; disabled: boolean }

export type QueuedTurn = {
  id: string
  turn: Turn
  withdraw?: QueuedWithdraw
}

export type QueuedTranscript = {
  rows: readonly QueuedTurn[]
  onEdit: (inboxId: string) => void
  onRemove: (inboxId: string) => void
}

const QUEUED_NOTICE_ID = 'queued-notice'

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
    threadId: last?.threadId ?? toThreadId(QUEUED_NOTICE_ID),
    runId: last?.runId ?? toRunId(QUEUED_NOTICE_ID),
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

const stagedBodyOf = (staged: StagedMessage): EventBody => ({
  type: 'user-said',
  text: staged.text,
  clientId: staged.clientId,
  ...(staged.attachments.length === 0 ? {} : { attachments: staged.attachments }),
})

const turnOfEvent = (args: {
  event: Event
  events: readonly Event[]
  sessionNameOf: SessionNameOf | undefined
}): Turn | null => {
  const durable = durableTranscriptOf({ events: [args.event] })
  const report = reportItemsOf([...args.events, args.event]).get(args.event.id)
  const view = transcriptViewOf({
    durable: report === undefined ? durable : { ...durable, reports: [report] },
    live: [],
    ...(args.sessionNameOf === undefined ? {} : { sessionNameOf: args.sessionNameOf }),
  })
  const turns = turnsOf({ items: view.items, working: false })
  return turns.find((turn) => turn.kind === ETurnKind.Report) ?? turns.at(0) ?? null
}

const withdrawFor = (args: { inboxId: number; event: Event }): QueuedWithdraw | undefined =>
  args.event.type === 'user-said' && saidBy(args.event) === EMessageOrigin.Operator
    ? { inboxId: String(args.inboxId), disabled: false }
    : undefined

const stagedRowOf = (args: {
  staged: StagedMessage
  events: readonly Event[]
  sessionNameOf: SessionNameOf | undefined
}): QueuedTurn | null => {
  const { staged } = args
  const event = stampEvent({
    draft: stagedBodyOf(staged),
    envelope: envelopeOf({
      id: staged.clientId,
      seq: 0,
      at: staged.at,
      events: args.events,
    }),
  })
  const turn = turnOfEvent({ event, events: args.events, sessionNameOf: args.sessionNameOf })
  return turn === null
    ? null
    : {
        id: staged.clientId,
        turn,
        withdraw: { inboxId: staged.clientId, disabled: true },
      }
}

export function queuedRowsOf(args: {
  pending: PendingInputsState
  events: readonly Event[]
  staged: readonly StagedMessage[]
  sessionNameOf?: SessionNameOf | undefined
  hiddenInboxIds?: ReadonlySet<number> | undefined
}): QueuedTurn[] {
  const pendingRows = args.pending.pending.flatMap((input) => {
    if (args.hiddenInboxIds?.has(input.inboxId) === true) return []
    const stamped = stampedInputOf({ input, events: args.events })
    if (stamped === null) return []
    const turn = turnOfEvent({
      event: stamped.event,
      events: args.events,
      sessionNameOf: args.sessionNameOf,
    })
    if (turn === null) return []
    const withdraw = withdrawFor({ inboxId: input.inboxId, event: stamped.event })
    return [{ id: stamped.id, turn, ...(withdraw === undefined ? {} : { withdraw }) }]
  })
  const stagedRows = args.staged.flatMap((staged) => {
    const row = stagedRowOf({ staged, events: args.events, sessionNameOf: args.sessionNameOf })
    return row === null ? [] : [row]
  })
  return [...pendingRows, ...stagedRows]
}

export const optimisticUserItemsOf = (staged: readonly StagedMessage[]): TranscriptRow[] =>
  staged.map((entry) => ({
    kind: ETranscriptKind.User as const,
    id: entry.clientId,
    clientId: entry.clientId,
    text: entry.text,
    at: entry.at,
    ...(entry.attachments.length === 0 ? {} : { attachments: entry.attachments }),
  }))
