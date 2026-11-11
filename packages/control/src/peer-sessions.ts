import { reportWakesParent, type EReportKind } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { postIn } from './inbox-ops'
import type { ControlSessionRow, ControlTx, SessionDigestRow } from './port'
import { createSessionIn } from './session-ops'

export type PeerRefusal = { refused: string }

export const spawnPeerIn = async (params: {
  tx: ControlTx
  spawner: ControlSessionRow
  sessionId: string
  mainThreadId: string
  title?: string | undefined
  brief?: string | undefined
  nested?: boolean | undefined
  at: string
}): Promise<{ inboxId: number | null }> => {
  const { tx, spawner } = params
  await createSessionIn({
    tx,
    sessionId: params.sessionId,
    userId: spawner.userId,
    projectId: spawner.projectId,
    ...(params.title === undefined ? {} : { title: params.title }),
    mainThreadId: params.mainThreadId,
    spawnedBySessionId: spawner.sessionId,
    nested: params.nested,
    at: params.at,
  })
  if (params.brief === undefined || params.brief.trim() === '') return { inboxId: null }
  const posted = await postIn({
    tx,
    sessionId: params.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text: params.brief }),
    at: params.at,
    senderSessionId: spawner.sessionId,
  })
  return { inboxId: posted.inboxId }
}

export const messageTeammateIn = async (params: {
  tx: ControlTx
  from: ControlSessionRow
  toSessionId: string
  text: string
  at: string
}): Promise<{ inboxId: number } | PeerRefusal> => {
  const { tx, from } = params
  const to = await tx.lockSession(params.toSessionId)
  if (to === undefined || to.userId !== from.userId) {
    return {
      refused: `there is no session ${params.toSessionId} in this project`,
    }
  }
  if (to.spawnedBySessionId !== from.sessionId || !to.nested) {
    return {
      refused: `session ${params.toSessionId} is not one of this session’s nested teammates`,
    }
  }
  return postIn({
    tx,
    sessionId: to.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text: params.text }),
    at: params.at,
    senderSessionId: from.sessionId,
  })
}

export const reportToSpawnerIn = async (params: {
  tx: ControlTx
  session: ControlSessionRow
  kind: EReportKind
  text: string
  at: string
}): Promise<{ inboxId: number } | PeerRefusal> => {
  const spawnerId = params.session.spawnedBySessionId
  if (spawnerId === null) {
    return {
      refused: 'this session was not created by another session, so it has no spawner',
    }
  }
  const spawner = await params.tx.lockSession(spawnerId)
  if (spawner === undefined) {
    return {
      refused: `the session ${spawnerId} that created this one no longer exists`,
    }
  }
  return postIn({
    tx: params.tx,
    sessionId: spawner.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text: params.text }),
    at: params.at,
    senderSessionId: params.session.sessionId,
    wake: reportWakesParent(params.kind),
  })
}

export const messagePeerIn = async (params: {
  tx: ControlTx
  from: ControlSessionRow
  toSessionId: string
  text: string
  at: string
}): Promise<{ inboxId: number } | PeerRefusal> => {
  const { tx, from } = params
  const to = await tx.lockSession(params.toSessionId)
  if (to === undefined || to.userId !== from.userId) {
    return {
      refused: `there is no session ${params.toSessionId} in this project`,
    }
  }
  return postIn({
    tx,
    sessionId: to.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text: params.text }),
    at: params.at,
    senderSessionId: from.sessionId,
  })
}

export const sessionsOfIn = async (params: {
  tx: ControlTx
  session: ControlSessionRow
}): Promise<{ sessions: readonly SessionDigestRow[] }> => ({
  sessions: await params.tx.listSessionDigests({
    userId: params.session.userId,
    limit: 100,
  }),
})
