import { claimGrant, type Lease } from '@dltech/atlas-core'

import { claimableSessionIdsIn } from './memory-claim-candidates'
import type { State } from './memory-state'

export const claimNeedingIn = (params: {
  state: State
  presentHosts: ReadonlySet<number>
  hostId: number
  now: string
  limit: number
}): Lease[] => {
  if (!params.presentHosts.has(params.hostId)) return []
  const now = Date.parse(params.now)
  const claimed: Lease[] = []
  const needing = claimableSessionIdsIn({
    state: params.state,
    presentHosts: params.presentHosts,
    limit: Number.POSITIVE_INFINITY,
  })
  for (const sessionId of needing) {
    if (claimed.length >= params.limit) break
    const lease = params.state.leases.get(sessionId)
    if (lease === undefined) continue
    if (lease.retryAfter !== null && Date.parse(lease.retryAfter) > now) continue
    const next = claimGrant({ lease, hostId: params.hostId, now: params.now })
    params.state.leases.set(sessionId, next)
    claimed.push({ ...next })
  }
  return claimed
}
