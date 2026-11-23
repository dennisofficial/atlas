import {
  ENoticeStage,
  isMessageInputKind,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventEnvelope,
  type PendingInput,
  type PendingInputsState,
} from '@dltech/atlas-core'
import { noticeEntriesOf } from '@dltech/atlas-client/transcript'
import type { QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'

import { reportItemsOf, type ReportItem } from '@/features/threads/data/transcript-agents'
import { ETranscriptKind, type TranscriptRow } from '@/features/threads/data/transcript-items'
import { noticeItemOf, type NoticeItem } from '@/features/threads/data/transcript-notices'

import { queuedEntryOf, visibleQueuedOf, type StagedMessage } from './queued-messages'

export enum EQueuedRowKind {
  Notice = 'notice',
  Report = 'report',
  Message = 'message',
}

export type QueuedRow =
  | { kind: EQueuedRowKind.Notice; id: string; item: NoticeItem }
  | { kind: EQueuedRowKind.Report; id: string; item: ReportItem }
  | { kind: EQueuedRowKind.Message; id: string; entry: QueuedMessageEntry; optimistic?: true }

export type QueuedTranscript = {
  rows: readonly QueuedRow[]
  onEdit: (inboxId: string) => void
  onRemove: (inboxId: string) => void
}

const QUEUED_NOTICE_ID = 'queued-notice'

const rowIdOf = (inboxId: number): string => `queued-${inboxId}`

const messageRowIdOf = (input: PendingInput): string =>
  input.message?.clientId ?? rowIdOf(input.inboxId)

const envelopeOf = (args: { input: PendingInput; events: readonly Event[] }): EventEnvelope => {
  const last = args.events.at(-1)
  return {
    id: toEventId(rowIdOf(args.input.inboxId)),
    seq: args.input.seq,
    threadId: last?.threadId ?? toThreadId(QUEUED_NOTICE_ID),
    runId: last?.runId ?? toRunId(QUEUED_NOTICE_ID),
    depth: last?.depth ?? 0,
    at: args.input.at,
  }
}

const stampedEventOf = (args: { input: PendingInput; events: readonly Event[] }): Event | null => {
  const body = args.input.event
  if (body === undefined) return null
  return stampEvent({
    draft: {
      ...body,
      notice: { id: rowIdOf(args.input.inboxId), stage: ENoticeStage.Delivered },
    },
    envelope: envelopeOf(args),
  })
}

const noticeRowOf = (event: Event): QueuedRow | null => {
  const entries = noticeEntriesOf(event)
  if (entries === null) return null
  const [entry] = entries
  if (entry === undefined) return null
  const item = noticeItemOf(entry)
  return item === null ? null : { kind: EQueuedRowKind.Notice, id: event.id, item }
}

const noticeRowsOf = (args: {
  inputs: readonly PendingInput[]
  events: readonly Event[]
}): ReadonlyMap<number, QueuedRow> => {
  const stamped = args.inputs.flatMap((input) => {
    const event = stampedEventOf({ input, events: args.events })
    return event === null ? [] : [{ input, event }]
  })
  const reports = reportItemsOf([...args.events, ...stamped.map(({ event }) => event)])
  const rows = new Map<number, QueuedRow>()
  for (const { input, event } of stamped) {
    const report = reports.get(event.id)
    const row =
      report === undefined
        ? noticeRowOf(event)
        : { kind: EQueuedRowKind.Report as const, id: event.id, item: report }
    if (row !== null) rows.set(input.inboxId, row)
  }
  return rows
}

export function queuedRowsOf(args: {
  pending: PendingInputsState
  events: readonly Event[]
  urls: ReadonlyMap<string, string>
  hiddenInboxIds?: ReadonlySet<number> | undefined
}): QueuedRow[] {
  const messages = new Map(
    visibleQueuedOf({ pending: args.pending, urls: args.urls }).map((entry) => [entry.id, entry]),
  )
  const notices = noticeRowsOf({
    inputs: args.pending.pending.filter((input) => !isMessageInputKind(input.kind)),
    events: args.events,
  })
  return args.pending.pending.flatMap((input) => {
    if (args.hiddenInboxIds?.has(input.inboxId) === true) return []
    if (isMessageInputKind(input.kind)) {
      const entry = messages.get(String(input.inboxId))
      return entry === undefined
        ? []
        : [{ kind: EQueuedRowKind.Message as const, id: messageRowIdOf(input), entry }]
    }
    const notice = notices.get(input.inboxId)
    return notice === undefined ? [] : [notice]
  })
}

export const optimisticQueuedRowsOf = (args: {
  staged: readonly StagedMessage[]
  urls: ReadonlyMap<string, string>
}): QueuedRow[] =>
  args.staged.map((staged) => ({
    kind: EQueuedRowKind.Message as const,
    id: staged.clientId,
    optimistic: true as const,
    entry: queuedEntryOf({
      message: { id: staged.clientId, text: staged.text, attachments: staged.attachments },
      urls: args.urls,
    }),
  }))

export const optimisticUserItemsOf = (staged: readonly StagedMessage[]): TranscriptRow[] =>
  staged.map((entry) => ({
    kind: ETranscriptKind.User as const,
    id: entry.clientId,
    clientId: entry.clientId,
    text: entry.text,
    at: entry.at,
    ...(entry.attachments.length === 0 ? {} : { attachments: entry.attachments }),
  }))
