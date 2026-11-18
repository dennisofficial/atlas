import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'

import type { ControlTx } from './port'

export const INBOX_KIND_WITHDRAW = 'withdraw'

export const INBOX_IDEMPOTENCY_LOOKBACK = 200

export type WithdrawPayload = { targetInboxId: number }

export const withdrawPayloadOf = (payload: string): WithdrawPayload | undefined => {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const target = (parsed as { targetInboxId?: unknown }).targetInboxId
    return typeof target === 'number' && Number.isInteger(target) && target >= 1
      ? { targetInboxId: target }
      : undefined
  } catch {
    return undefined
  }
}

const clientIdOfPayload = (payload: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const clientId = (parsed as { clientId?: unknown }).clientId
    return typeof clientId === 'string' && clientId.length > 0 ? clientId : undefined
  } catch {
    return undefined
  }
}

const parsedPayloadOf = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

const messageNamesItsOrigin = (params: {
  payload: string
  senderSessionId: string | undefined
}): boolean => {
  if (params.senderSessionId !== undefined) return true
  const message = inboxMessageSchema.safeParse(parsedPayloadOf(params.payload))
  return message.success && message.data.via !== undefined
}

export class MessageOriginRequiredError extends Error {
  constructor() {
    super('a message must name its origin: post it with a via, or from a session with a sender')
    this.name = 'MessageOriginRequiredError'
  }
}

const alreadyPosted = async (params: {
  tx: ControlTx
  sessionId: string
  kind: string
  clientId: string | undefined
}): Promise<number | undefined> => {
  if (params.clientId === undefined) return undefined
  const recent = await params.tx.recentInboxEntries({
    sessionId: params.sessionId,
    limit: INBOX_IDEMPOTENCY_LOOKBACK,
  })
  return recent.find(
    (entry) => entry.kind === params.kind && clientIdOfPayload(entry.payload) === params.clientId,
  )?.inboxId
}

export const postIn = async (params: {
  tx: ControlTx
  sessionId: string
  kind: string
  payload: string
  at: string
  senderSessionId?: string | undefined
  wake?: boolean | undefined
}): Promise<{ inboxId: number }> => {
  if (
    params.kind === INBOX_KIND_MESSAGE &&
    !messageNamesItsOrigin({ payload: params.payload, senderSessionId: params.senderSessionId })
  ) {
    throw new MessageOriginRequiredError()
  }
  const existing = await alreadyPosted({
    tx: params.tx,
    sessionId: params.sessionId,
    kind: params.kind,
    clientId: clientIdOfPayload(params.payload),
  })
  if (existing !== undefined) return { inboxId: existing }
  const inboxId = await params.tx.allocateInboxId(params.sessionId)
  await params.tx.insertInboxEntry({
    sessionId: params.sessionId,
    inboxId,
    kind: params.kind,
    payload: params.payload,
    postedAt: params.at,
    consumedSeq: null,
    senderSessionId: params.senderSessionId ?? null,
  })
  if (params.wake !== false) await params.tx.notifyWake(params.sessionId)
  await params.tx.announce({ sessionId: params.sessionId })
  return { inboxId }
}

export const withdrawIn = async (params: {
  tx: ControlTx
  sessionId: string
  inboxId: number
  at: string
}): Promise<{ requestInboxId: number }> => {
  const payload: WithdrawPayload = { targetInboxId: params.inboxId }
  const posted = await postIn({
    tx: params.tx,
    sessionId: params.sessionId,
    kind: INBOX_KIND_WITHDRAW,
    payload: JSON.stringify(payload),
    at: params.at,
  })
  return { requestInboxId: posted.inboxId }
}
