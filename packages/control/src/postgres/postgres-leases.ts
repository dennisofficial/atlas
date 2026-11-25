import { isUniqueViolation, type Tx } from '@dltech/atlas-db'
import type { Lease } from '@dltech/atlas-core'

export const writeLeaseIn = async (params: {
  tx: Tx
  lease: Lease
  expectedEpoch: number
}): Promise<boolean> => {
  const { tx, lease } = params
  const existing = await tx.orm.public.Lease.first({ sessionId: lease.sessionId })
  const data = {
    epoch: lease.epoch,
    holderHostId: lease.holderHostId,
    wantsHolder: lease.wantsHolder,
    attempts: lease.attempts,
    retryAfter: lease.retryAfter === null ? null : new Date(lease.retryAfter),
  }
  if (existing === null) {
    if (params.expectedEpoch !== 0) return false
    try {
      await tx.orm.public.Lease.create({ sessionId: lease.sessionId, ...data })
    } catch (error) {
      if (isUniqueViolation(error)) return false
      throw error
    }
    return true
  }
  const changed = await tx.orm.public.Lease.where({
    sessionId: lease.sessionId,
    epoch: params.expectedEpoch,
  }).updateAndCount(data)
  return changed === 1
}
