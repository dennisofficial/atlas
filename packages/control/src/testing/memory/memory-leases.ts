import type { Lease } from '@dltech/atlas-core'

import type { State } from './memory-state'

export const leasesHeldByIn = (params: { state: State; hostId: number; limit: number }): Lease[] =>
  [...params.state.leases.values()]
    .filter((lease) => lease.holderHostId === params.hostId)
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    .slice(0, params.limit)
    .map((lease) => ({ ...lease }))
