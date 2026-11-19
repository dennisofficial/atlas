import { effortRungOf, parseRef, type ModelChoice } from '@dltech/atlas-core'
import type { SessionModelAsk } from '@dltech/atlas-models'
import { ECredentialSource, ESandboxProvider } from '@dltech/atlas-protocol'

import { EMPTY_VISIBILITY_TEXT } from './stored-event'
import type { ControlSessionRow, ControlTx, SessionModelRow } from './port'

export const createSessionIn = async (params: {
  tx: ControlTx
  sessionId: string
  userId: string
  projectId: string | null
  title?: string | undefined
  mainThreadId: string
  model?: SessionModelAsk | undefined
  sandboxProvider?: string | undefined
  credentialSource?: string | undefined
  sandboxInstanceId?: string | null | undefined
  spawnedBySessionId?: string | undefined
  nested?: boolean | undefined
  podSessionId?: string | undefined
  routineId?: string | undefined
  at: string
}): Promise<SessionModelRow> => {
  const { tx, model, ...session } = params
  const { at } = session
  const resolved = await tx.resolveSessionModel({
    userId: params.userId,
    projectId: params.projectId,
    ask: model ?? {},
  })
  await tx.createSession({
    ...session,
    sandboxProvider: params.sandboxProvider ?? ESandboxProvider.Vercel,
    credentialSource: params.credentialSource ?? ECredentialSource.Platform,
    sandboxInstanceId: params.sandboxInstanceId ?? null,
    ...resolved,
  })
  await tx.createThread({
    threadId: params.mainThreadId,
    sessionId: params.sessionId,
    visibility: EMPTY_VISIBILITY_TEXT,
    at,
  })
  await tx.notifyWake(params.sessionId)
  await tx.announce({ sessionId: params.sessionId, threadId: params.mainThreadId, headSeq: 0 })
  return resolved
}

const currentChoiceOf = (row: ControlSessionRow): ModelChoice | undefined => {
  const ref = parseRef(row.modelRef)
  const effort = effortRungOf(row.modelEffort)
  if (ref === undefined || effort === undefined) return undefined
  return { ref, effort, fast: row.modelFast }
}

export const setSessionModelIn = async (params: {
  tx: ControlTx
  sessionId: string
  ask: SessionModelAsk
}): Promise<SessionModelRow> => {
  const { tx, sessionId } = params
  const session = await tx.lockSession(sessionId)
  if (session === undefined) throw new Error(`unknown session ${sessionId}`)
  const current = currentChoiceOf(session)
  const model = await tx.resolveSessionModel({
    userId: session.userId,
    projectId: session.projectId,
    ask: params.ask,
    ...(current === undefined ? {} : { current }),
  })
  await tx.setSessionModel({ sessionId, ...model })
  await tx.announce({ sessionId })
  return model
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

export const markReadIn = async (params: {
  tx: ControlTx
  sessionId: string
  seq: number
}): Promise<number> => {
  const { tx, sessionId, seq } = params
  const readSeq = await tx.setSessionReadSeq({ sessionId, seq })
  if (readSeq === undefined) throw new Error(`unknown session ${sessionId}`)
  await tx.announce({ sessionId })
  return readSeq
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

export const SESSION_TITLE_MAX_LENGTH = 200

export const renameIn = async (params: {
  tx: ControlTx
  sessionId: string
  title: string
}): Promise<void> => {
  const { tx, sessionId } = params
  const title = params.title.trim()
  if (title.length === 0) throw new Error('A session needs a name')
  if (title.length > SESSION_TITLE_MAX_LENGTH) {
    throw new Error(`A session name is at most ${SESSION_TITLE_MAX_LENGTH} characters`)
  }
  if (!(await tx.setSessionTitle({ sessionId, title }))) {
    throw new Error(`unknown session ${sessionId}`)
  }
  await tx.announce({ sessionId })
}
