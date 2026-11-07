import type { Lease } from '@dltech/atlas-core'

import type { State } from './memory-state'

export const leasesHeldByIn = (params: { state: State; hostId: number; limit: number }): Lease[] =>
  [...params.state.leases.values()]
    .filter((lease) => lease.holderHostId === params.hostId)
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    .slice(0, params.limit)
    .map((lease) => ({ ...lease }))

export const writeLeaseIn = (params: {
  state: State
  lease: Lease
  expectedEpoch: number
}): boolean => {
  const { state, lease } = params
  const current = state.leases.get(lease.sessionId)
  if (!state.sessions.has(lease.sessionId)) return false
  const epoch = current?.epoch ?? 0
  if (epoch !== params.expectedEpoch) return false
  if (current === undefined && params.expectedEpoch !== 0) return false
  state.leases.set(lease.sessionId, { ...lease })
  return true
}
