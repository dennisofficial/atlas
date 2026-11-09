import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { postIn } from './inbox-ops'
import type { ControlSessionRow, ControlTx, SessionDigestRow } from './port'
import { createSessionIn } from './session-ops'

export const PEER_MESSAGE_BUDGET = 20

export type PeerRefusal = { refused: string }

export const spawnPeerIn = async (params: {
  tx: ControlTx
  spawner: ControlSessionRow
  sessionId: string
  mainThreadId: string
  title?: string | undefined
  brief?: string | undefined
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
    podSessionId: spawner.podSessionId ?? spawner.sessionId,
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
    return { refused: `there is no session ${params.toSessionId} in this project` }
  }
  const spawnerSends = to.spawnedBySessionId === from.sessionId
  const peerReplies = from.spawnedBySessionId === to.sessionId
  if (!spawnerSends && !peerReplies) {
    return {
      refused: 'you can message only a session you spawned, or the session that spawned you',
    }
  }
  if (spawnerSends) {
    const sent = await tx.claimPeerMessage({
      sessionId: to.sessionId,
      budget: PEER_MESSAGE_BUDGET,
    })
    if (sent === null) {
      return {
        refused: `this session has received all ${PEER_MESSAGE_BUDGET} messages the operator's budget allows; the operator can reset it`,
      }
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

export const peersOfIn = async (params: {
  tx: ControlTx
  session: ControlSessionRow
}): Promise<{ spawner: ControlSessionRow | null; peers: SessionDigestRow[] }> => {
  const spawner =
    params.session.spawnedBySessionId === null
      ? null
      : ((await params.tx.readSession({ sessionId: params.session.spawnedBySessionId })) ?? null)
  const peers = await params.tx.listSessionDigests({
    userId: params.session.userId,
    spawnedBySessionId: params.session.sessionId,
    limit: 100,
  })
  return { spawner, peers }
}
