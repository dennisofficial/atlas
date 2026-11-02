export type InboxEntry = {
  sessionId: string
  inboxId: number
  kind: string
  payload: string
  postedAt: string
  consumedSeq: number | null
}

export type InboxRefusal = { kind: 'already-consumed' } | { kind: 'unknown-inbox-entry' }

export type TakeBackResult = { ok: true; action: 'delete' } | { ok: false; refusal: InboxRefusal }

export type ConsumeResult = { ok: true; entry: InboxEntry } | { ok: false; refusal: InboxRefusal }

export const takeBack = (entry: InboxEntry): TakeBackResult =>
  entry.consumedSeq === null
    ? { ok: true, action: 'delete' }
    : { ok: false, refusal: { kind: 'already-consumed' } }

export function consume(params: { entry: InboxEntry | undefined; seq: number }): ConsumeResult {
  if (params.entry === undefined) return { ok: false, refusal: { kind: 'unknown-inbox-entry' } }
  if (params.entry.consumedSeq !== null) return { ok: false, refusal: { kind: 'already-consumed' } }
  return { ok: true, entry: { ...params.entry, consumedSeq: params.seq } }
}
