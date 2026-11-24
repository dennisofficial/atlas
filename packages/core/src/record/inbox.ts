import type { ThreadId } from '../events/ids'

export const INBOX_KIND_STOP = 'stop'
export const INBOX_KIND_RETRY = 'retry'
export const INBOX_KIND_RECORD = 'record'

export type InboxEntry = {
  sessionId: string
  inboxId: number
  kind: string
  payload: string
  postedAt: string
  consumedSeq: number | null
  threadId: ThreadId | null
  senderSessionId: string | null
}

export type InboxRefusal = { kind: 'already-consumed' } | { kind: 'unknown-inbox-entry' }

export type ConsumeResult = { ok: true; entry: InboxEntry } | { ok: false; refusal: InboxRefusal }

export function consume(params: { entry: InboxEntry | undefined; seq: number }): ConsumeResult {
  if (params.entry === undefined) return { ok: false, refusal: { kind: 'unknown-inbox-entry' } }
  if (params.entry.consumedSeq !== null) return { ok: false, refusal: { kind: 'already-consumed' } }
  return { ok: true, entry: { ...params.entry, consumedSeq: params.seq } }
}
