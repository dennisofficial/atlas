import { claimGrant, type Lease } from '@dltech/atlas-core'

import type { ClaimedBatch } from '../../port'
import { claimableLeasesIn, nextRetryAtIn } from './memory-claim-candidates'
import type { State } from './memory-state'

export const claimNeedingIn = (params: {
  state: State
  presentHosts: ReadonlySet<number>
  hostId: number
  now: string
  limit: number
}): ClaimedBatch => {
  if (!params.presentHosts.has(params.hostId)) return { leases: [], nextRetryAt: null }
  const claimed: Lease[] = []
  const candidates = claimableLeasesIn(params)
  for (const lease of candidates.slice(0, params.limit)) {
    const next = claimGrant({ lease, hostId: params.hostId, now: params.now })
    params.state.leases.set(lease.sessionId, next)
    claimed.push({ ...next })
  }
  return { leases: claimed, nextRetryAt: nextRetryAtIn(params) }
}
