import type { Lease } from '@dltech/atlas-core'

import type { ControlTx } from './port'
import { EMPTY_VISIBILITY_TEXT } from './stored-event'

export const archiveIn = async (params: {
  tx: ControlTx
  sessionId: string
  archivedAt: string | null
}): Promise<void> => {
  const { tx, ...change } = params
  if (!(await tx.setSessionArchived(change))) {
    throw new Error(`unknown session ${params.sessionId}`)
  }
  await tx.announce({ sessionId: params.sessionId })
}

const sourceIsGone = async (params: {
  tx: ControlTx
  sessionId: string
  fromInboxId: number | null
}): Promise<boolean> => {
  if (params.fromInboxId === null) return false
  const entry = await params.tx.readInboxEntry({
    sessionId: params.sessionId,
    inboxId: params.fromInboxId,
  })
  return entry === undefined
}

export const titleUntitledIn = async (params: {
  tx: ControlTx
  sessionId: string
  title: string
  fromInboxId?: number | undefined
}): Promise<boolean> => {
  const { tx, sessionId, title } = params
  const fromInboxId = params.fromInboxId ?? null
  const session = await tx.lockSession(sessionId)
  if (session === undefined || session.title !== null) return false
  if (await sourceIsGone({ tx, sessionId, fromInboxId })) return false
  const titled = await tx.setSessionTitleIfUntitled({
    sessionId,
    title,
    fromInboxId,
  })
  if (titled) await tx.announce({ sessionId })
  return titled
}

export const createSessionIn = async (params: {
  tx: ControlTx
  sessionId: string
  userId: string
  projectId: string
  title?: string | undefined
  mainThreadId: string
  at: string
}): Promise<void> => {
  const { tx, ...session } = params
  await tx.createSession(session)
  await tx.createThread({
    threadId: params.mainThreadId,
    sessionId: params.sessionId,
    visibility: EMPTY_VISIBILITY_TEXT,
    at: params.at,
  })
  await tx.notifyWake(params.sessionId)
  await tx.announce({ sessionId: params.sessionId, threadId: params.mainThreadId, headSeq: 0 })
}

export const wakeIn = async (params: {
  tx: ControlTx
  sessionIds: readonly string[]
}): Promise<void> => {
  for (const sessionId of params.sessionIds) {
    await params.tx.notifyWake(sessionId)
    await params.tx.announce({ sessionId })
  }
}

export const claimNextIn = async (params: {
  tx: ControlTx
  hostId: number
  now: string
  limit: number
}): Promise<Lease[]> => {
  const { tx, ...claim } = params
  const claimed = await tx.claimNeeding(claim)
  for (const lease of claimed) await tx.announce({ sessionId: lease.sessionId })
  return claimed
}
