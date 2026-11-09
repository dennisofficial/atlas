import type { Tx } from '@dltech/atlas-db'

import { allocateInboxIdIn, insertInboxEntryIn } from './postgres-inbox'
import { announceIn, notifyWakeIn } from './postgres-notify'

export const postInboxEntryIn = async (params: {
  tx: Tx
  sessionId: string
  kind: string
  payload: string
  at: string
}): Promise<{ inboxId: number }> => {
  const { tx, sessionId } = params
  const inboxId = await allocateInboxIdIn({ tx, sessionId })
  await insertInboxEntryIn({
    tx,
    entry: {
      sessionId,
      inboxId,
      kind: params.kind,
      payload: params.payload,
      postedAt: params.at,
      consumedSeq: null,
      senderSessionId: null,
    },
  })
  await notifyWakeIn({ tx, sessionId })
  await announceIn({ tx, change: { sessionId } })
  return { inboxId }
}
