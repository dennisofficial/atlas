import { EMPTY_VISIBILITY_TEXT } from './stored-event'
import type { ControlTx } from './port'

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
  const { at } = session
  await tx.createSession(session)
  await tx.createThread({
    threadId: params.mainThreadId,
    sessionId: params.sessionId,
    visibility: EMPTY_VISIBILITY_TEXT,
    at,
  })
  await tx.notifyWake(params.sessionId)
  await tx.announce({ sessionId: params.sessionId, threadId: params.mainThreadId, headSeq: 0 })
}

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
  const titled = await tx.setSessionTitleIfUntitled({ sessionId, title, fromInboxId })
  if (titled) await tx.announce({ sessionId })
  return titled
}
