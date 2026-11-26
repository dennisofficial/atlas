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

import { postIn, postedReceiptOf } from './inbox-ops'
import type { ControlSessionRow, ControlTx, EffectReceiptKey, SessionDigestRow } from './port'
import { createSessionIn } from './session-ops'

export type PeerRefusal = { refused: string }

const spawnRefusalOf = (params: {
  existing: ControlSessionRow
  sessionId: string
  spawner: ControlSessionRow
}): string | undefined =>
  params.existing.spawnedBySessionId === params.spawner.sessionId &&
  params.existing.userId === params.spawner.userId
    ? undefined
    : `the session ${params.sessionId} already exists and this session did not create it`

export const spawnBriefClientIdOf = (sessionId: string): string => `spawn-brief:${sessionId}`

const SPAWN_RECEIPT_NAMESPACE = 'spawn'

const spawnReceiptOf = (params: {
  spawnerSessionId: string
  sessionId: string
}): EffectReceiptKey => ({
  threadId: `${SPAWN_RECEIPT_NAMESPACE}:${params.spawnerSessionId}`,
  stepKey: params.sessionId,
})

const archivedRefusalOf = (session: ControlSessionRow): string | undefined =>
  session.archivedAt === null
    ? undefined
    : `session ${session.sessionId} is archived, so it cannot act on a message. The operator can unarchive it.`

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
  at: string
}): Promise<{ inboxId: number | null; already: boolean } | PeerRefusal> => {
  const { tx, spawner } = params
  const files = params.files ?? []
  const refusal = spawnFilesRefusalOf(files)
  if (refusal !== null) return { refused: refusal }
  let existing = await tx.readSession({ sessionId: params.sessionId })
  if (existing !== undefined) {
    const refused = spawnRefusalOf({ existing, sessionId: params.sessionId, spawner })
    if (refused !== undefined) return { refused }
  }
  const receipt = spawnReceiptOf({
    spawnerSessionId: spawner.sessionId,
    sessionId: params.sessionId,
  })
  const claim = await tx.claimEffectReceipt(receipt)
  if (claim.kind === 'replayed') {
    existing = await tx.readSession({ sessionId: params.sessionId })
    if (existing !== undefined) {
      const refused = spawnRefusalOf({ existing, sessionId: params.sessionId, spawner })
      if (refused !== undefined) return { refused }
    }
  }
  if (existing === undefined) {
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
  }
  const already = existing !== undefined
  const text = spawnBriefOf({ brief: params.brief, files })
  if (text === '') {
    if (claim.kind === 'claimed') {
      await tx.completeEffectReceipt({ ...receipt, result: { inboxId: null } })
    }
    return { inboxId: null, already }
  }
  const posted = await postIn({
    tx,
    sessionId: params.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({
      text,
      via: EMessageOrigin.PeerAgent,
      clientId: spawnBriefClientIdOf(params.sessionId),
      ...(files.length === 0 ? {} : { files }),
    }),
    at: params.at,
    senderSessionId: spawner.sessionId,
    receipt: spawnBriefClientIdOf(params.sessionId),
  })
  if (claim.kind === 'claimed') {
    await tx.completeEffectReceipt({ ...receipt, result: { inboxId: posted.inboxId } })
  }
  return { inboxId: posted.inboxId, already }
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
  const posted = await postedReceiptOf({
    tx: params.tx,
    sessionId: spawner.sessionId,
    receipt: params.clientId,
  })
  if (posted !== undefined) return posted
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
    ...(params.clientId === undefined ? {} : { receipt: params.clientId }),
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
  const delivered = await postedReceiptOf({ tx, sessionId: to.sessionId, receipt: params.clientId })
  if (delivered !== undefined) return { inboxId: delivered.inboxId, title: to.title }
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
    ...(params.clientId === undefined ? {} : { receipt: params.clientId }),
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
