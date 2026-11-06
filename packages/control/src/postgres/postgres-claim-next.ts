import type { Tx } from '@dltech/atlas-db'
import { claimGrant, type Lease } from '@dltech/atlas-core'

import { claimableSessionIdsIn } from './postgres-claim-candidates'
import { writeLeaseIn } from './postgres-leases'
import { hostPresentIn } from './postgres-presence'
import { toLease } from './postgres-rows'

export const claimNeedingIn = async (params: {
  tx: Tx
  hostId: number
  now: string
  limit: number
}): Promise<Lease[]> => {
  const { tx } = params
  if (!(await hostPresentIn({ tx, hostId: params.hostId }))) return []
  const sessionIds = await claimableSessionIdsIn({ tx, now: params.now, limit: params.limit })
  const claimed: Lease[] = []
  for (const sessionId of sessionIds) {
    const row = await tx.orm.v2.V2Lease.first({ sessionId })
    if (row === null) continue
    const current = toLease(row)
    const next = claimGrant({ lease: current, hostId: params.hostId, now: params.now })
    if (!(await writeLeaseIn({ tx, lease: next, expectedEpoch: current.epoch }))) continue
    claimed.push(next)
  }
  return claimed
}
