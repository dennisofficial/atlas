import { COMMAND_INBOX_PREFIX } from '@dltech/atlas-commands'
import { INBOX_KIND_RECORD } from '@dltech/atlas-core'

import type { ClaimedBatch, ControlTx } from './port'

export const COMMAND_KIND_LIKE = `${COMMAND_INBOX_PREFIX}%`

export const wakesHolderOf = (kind: string): boolean => !kind.startsWith(COMMAND_INBOX_PREFIX)

export const asksForHolderOf = (kind: string): boolean =>
  wakesHolderOf(kind) && kind !== INBOX_KIND_RECORD

export const claimNextIn = async (params: {
  tx: ControlTx
  hostId: number
  limit: number
  now: string
}): Promise<ClaimedBatch> => {
  const { tx } = params
  const claimed = await tx.claimNeeding({
    hostId: params.hostId,
    now: params.now,
    limit: params.limit,
  })
  for (const lease of claimed.leases) await tx.announce({ sessionId: lease.sessionId })
  return claimed
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
