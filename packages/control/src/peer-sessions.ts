import {
  EMessageOrigin,
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  spawnBriefOf,
  spawnFilesRefusalOf,
  TEAMMATE_AGENT_TYPE,
  toThreadId,
  type SpawnFile,
} from '@dltech/atlas-core'
import type { SessionModelAsk } from '@dltech/atlas-models'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { postIn } from './inbox-ops'
import type { ControlSessionRow, ControlTx, SessionDigestRow } from './port'
import { createSessionIn } from './session-ops'

export type PeerRefusal = { refused: string }

const archivedRefusalOf = (session: ControlSessionRow): string | undefined =>
  session.archivedAt === null
    ? undefined
    : `session ${session.sessionId} is archived, so it cannot act on a message. The operator can unarchive it.`

const postSpawnBrief = async (params: {
  tx: ControlTx
  spawner: ControlSessionRow
  sessionId: string
  brief?: string | undefined
  files: readonly SpawnFile[]
  clientId?: string | undefined
  at: string
}): Promise<{ inboxId: number | null } | PeerRefusal> => {
  const text = spawnBriefOf({ brief: params.brief, files: params.files })
  if (text === '') return { inboxId: null }
  const posted = await postIn({
    tx: params.tx,
    sessionId: params.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({
      text,
      via: EMessageOrigin.PeerAgent,
      ...(params.clientId === undefined ? {} : { clientId: params.clientId }),
      ...(params.files.length === 0 ? {} : { files: params.files }),
    }),
    at: params.at,
    senderSessionId: params.spawner.sessionId,
  })
  return { inboxId: posted.inboxId }
}

export const spawnPeerIn = async (params: {
  tx: ControlTx
  spawner: ControlSessionRow
  sessionId: string
  mainThreadId: string
  model?: SessionModelAsk | undefined
  title?: string | undefined
  brief?: string | undefined
  nested?: boolean | undefined
  files?: readonly SpawnFile[] | undefined
  clientId?: string | undefined
  at: string
}): Promise<{ inboxId: number | null } | PeerRefusal> => {
  const { tx, spawner } = params
  const files = params.files ?? []
  const refusal = spawnFilesRefusalOf(files)
  if (refusal !== null) return { refused: refusal }
  const existing = await tx.lockSession(params.sessionId)
  if (existing !== undefined && existing.spawnedBySessionId === spawner.sessionId) {
    return await postSpawnBrief({ ...params, files })
  }
  if (existing !== undefined) {
    return { refused: `the session ${params.sessionId} already exists` }
  }
  await createSessionIn({
    tx,
    sessionId: params.sessionId,
    userId: spawner.userId,
    projectId: spawner.projectId,
    ...(params.model === undefined ? {} : { model: params.model }),
    ...(params.title === undefined ? {} : { title: params.title }),
    mainThreadId: params.mainThreadId,
    spawnedBySessionId: spawner.sessionId,
    nested: params.nested,
    at: params.at,
  })
  return await postSpawnBrief({ ...params, files })
}

export const reportToSpawnerIn = async (params: {
  tx: ControlTx
  session: ControlSessionRow
  text: string
  clientId?: string | undefined
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
  const archived = archivedRefusalOf(spawner)
  if (archived !== undefined) return { refused: archived }
  return postIn({
    tx: params.tx,
    sessionId: spawner.sessionId,
    kind: INBOX_KIND_EVENT,
    payload: inboxEventPayloadOf({
      event: {
        type: 'agent-reported',
        agentId: toThreadId(params.session.mainThreadId),
        agentType: TEAMMATE_AGENT_TYPE,
        intent: params.session.title ?? `session ${params.session.sessionId}`,
        prose: params.text,
        senderSessionId: params.session.sessionId,
      },
      ...(params.clientId === undefined ? {} : { clientId: params.clientId }),
    }),
    at: params.at,
    senderSessionId: params.session.sessionId,
  })
}

export const messagePeerIn = async (params: {
  tx: ControlTx
  from: ControlSessionRow
  toSessionId: string
  text: string
  clientId?: string | undefined
  at: string
}): Promise<{ inboxId: number; title: string | null } | PeerRefusal> => {
  const { tx, from } = params
  const to = await tx.lockSession(params.toSessionId)
  if (to === undefined || to.userId !== from.userId) {
    return {
      refused: `there is no session ${params.toSessionId} in this project`,
    }
  }
  const archived = archivedRefusalOf(to)
  if (archived !== undefined) return { refused: archived }
  const posted = await postIn({
    tx,
    sessionId: to.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({
      text: params.text,
      via: EMessageOrigin.PeerAgent,
      ...(params.clientId === undefined ? {} : { clientId: params.clientId }),
    }),
    at: params.at,
    senderSessionId: from.sessionId,
  })
  return { inboxId: posted.inboxId, title: to.title }
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
