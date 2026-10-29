import { EEntryKind, type TranscriptEntry } from '@dltech/atlas-client/transcript'

import { ENoticeTone, ETranscriptKind } from './transcript-kind'

export type NoticeContext = {
  id: string
  label: string
  content: string
  superseded: boolean
}

export type NoticeItem = {
  kind: ETranscriptKind.Notice
  id: string
  title: string
  body: string
  emptyNote?: string
  tone: ENoticeTone
  contexts?: NoticeContext[]
  at?: string | undefined
}

const NO_BODY = 'no body'
const PRINTED_NOTHING = 'printed nothing'
const MATCHED_NOTHING = 'matched nothing'
const NOTICED_PREFIX = 'Atlas noticed — '

const toneOfFailed = (failed: boolean): ENoticeTone =>
  failed ? ENoticeTone.Failed : ENoticeTone.Ok

type NoticeFields = Omit<NoticeItem, 'kind' | 'id'>

const noticeOf = (args: { id: string; fields: NoticeFields }): NoticeItem => ({
  kind: ETranscriptKind.Notice,
  id: args.id,
  ...args.fields,
})

function shellNoticeOf(entry: TranscriptEntry): NoticeFields | null {
  switch (entry.kind) {
    case EEntryKind.BackgroundShellEnded:
    case EEntryKind.ServiceEnded:
      return {
        title: entry.text,
        body: entry.output,
        emptyNote: PRINTED_NOTHING,
        tone: toneOfFailed(entry.failed),
      }
    case EEntryKind.BackgroundShellAwaitingInput:
      return {
        title: entry.text,
        body: entry.output,
        emptyNote: PRINTED_NOTHING,
        tone: ENoticeTone.Failed,
      }
    case EEntryKind.BackgroundShellMatched:
      return {
        title: entry.text,
        body: entry.output,
        emptyNote: MATCHED_NOTHING,
        tone: ENoticeTone.Ok,
      }
    case EEntryKind.BackgroundShellStillRunning:
      return {
        title: entry.text,
        body: entry.output,
        emptyNote: PRINTED_NOTHING,
        tone: ENoticeTone.Ok,
      }
    default:
      return null
  }
}

function fieldsOf(entry: TranscriptEntry): NoticeFields | null {
  switch (entry.kind) {
    case EEntryKind.PrEvent:
      return {
        title: entry.text,
        body: entry.body,
        emptyNote: NO_BODY,
        tone: toneOfFailed(entry.failed),
      }
    case EEntryKind.SystemNotice:
      return {
        title: `${NOTICED_PREFIX}${entry.text}`,
        body: entry.content,
        tone: ENoticeTone.Quiet,
      }
    case EEntryKind.AgentRestarted:
      return { title: entry.text, body: '', tone: ENoticeTone.Ok }
    case EEntryKind.OperatorInput:
    case EEntryKind.HistoryCompacted:
      return { title: entry.text, body: '', tone: ENoticeTone.Quiet }
    case EEntryKind.SandboxNotice:
      return {
        title: entry.text,
        body: '',
        tone: entry.failed ? ENoticeTone.Attention : ENoticeTone.Quiet,
      }
    case EEntryKind.SystemContext:
      return {
        title: entry.text,
        body: '',
        tone: ENoticeTone.Quiet,
        contexts: entry.items.map((item) => ({
          id: item.key,
          label: item.label,
          content: item.content,
          superseded: item.superseded,
        })),
      }
    default:
      return shellNoticeOf(entry)
  }
}

export function noticeItemOf(entry: TranscriptEntry): NoticeItem | null {
  const fields = fieldsOf(entry)
  return fields === null ? null : noticeOf({ id: entry.key, fields })
}
