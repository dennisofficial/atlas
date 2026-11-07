import type { ClaimedBatch, ControlTx } from './port'

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
