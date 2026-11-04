import { takeBack, type InboxRefusal } from '@dltech/atlas-core'

import type { ControlTx } from './port'

export type TakeBackResult = { ok: true } | { ok: false; refusal: InboxRefusal }

export const postIn = async (params: {
  tx: ControlTx
  sessionId: string
  kind: string
  payload: string
  at: string
}): Promise<{ inboxId: number }> => {
  const inboxId = await params.tx.allocateInboxId(params.sessionId)
  await params.tx.insertInboxEntry({
    sessionId: params.sessionId,
    inboxId,
    kind: params.kind,
    payload: params.payload,
    postedAt: params.at,
    consumedSeq: null,
  })
  return { inboxId }
}

export const takeBackIn = async (params: {
  tx: ControlTx
  sessionId: string
  inboxId: number
}): Promise<TakeBackResult> => {
  const key = { sessionId: params.sessionId, inboxId: params.inboxId }
  const entry = await params.tx.readInboxEntry(key)
  if (entry === undefined) return { ok: false, refusal: { kind: 'unknown-inbox-entry' } }
  const move = takeBack(entry)
  if (!move.ok) return move
  const deleted = await params.tx.deleteInboxEntry(key)
  return deleted ? { ok: true } : { ok: false, refusal: { kind: 'already-consumed' } }
}
