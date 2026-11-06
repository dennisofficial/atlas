import { actionableInboxIds, type Lease } from '@dltech/atlas-core'

import { activeFailureOf, hasPrepareHistory, type State } from './memory-state'

const needingHolderIn = (params: { state: State; presentHosts: ReadonlySet<number> }): Lease[] => {
  const { state } = params
  return [...state.sessions.values()]
    .filter((row) => {
      const lease = state.leases.get(row.sessionId)
      if (lease !== undefined && lease.holderHostId !== null) {
        return !params.presentHosts.has(lease.holderHostId)
      }
      if (lease?.wantsHolder === true) return true
      const events = state.events.get(row.mainThreadId) ?? []
      const unconsumed = (state.inbox.get(row.sessionId) ?? []).filter(
        (entry) => entry.consumedSeq === null,
      )
      const actionable = actionableInboxIds({
        entries: unconsumed,
        failure: activeFailureOf(events),
      })
      return actionable.length > 0 || !hasPrepareHistory(events)
    })
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.sessionId.localeCompare(b.sessionId),
    )
    .flatMap((row) => {
      const lease = state.leases.get(row.sessionId)
      return lease === undefined ? [] : [lease]
    })
}

export const claimableLeasesIn = (params: {
  state: State
  presentHosts: ReadonlySet<number>
  now: string
}): Lease[] => {
  const now = Date.parse(params.now)
  return needingHolderIn(params).filter(
    (lease) => lease.retryAfter === null || Date.parse(lease.retryAfter) <= now,
  )
}

export const nextRetryAtIn = (params: {
  state: State
  presentHosts: ReadonlySet<number>
  now: string
}): string | null => {
  const now = Date.parse(params.now)
  const gated = needingHolderIn(params)
    .flatMap((lease) => (lease.retryAfter === null ? [] : [lease.retryAfter]))
    .filter((retryAfter) => Date.parse(retryAfter) > now)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return gated[0] ?? null
}
