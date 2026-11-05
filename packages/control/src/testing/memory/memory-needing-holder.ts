import { actionableInboxIds } from '@dltech/atlas-core'

import { leaseLiveAt } from './memory-helpers'
import { activeFailureOf, hasPrepareHistory, type State } from './memory-state'

export const sessionsNeedingHolderIn = (params: {
  state: State
  now: string
  limit: number
}): string[] => {
  const { state } = params
  return [...state.sessions.values()]
    .filter((row) => {
      const lease = state.leases.get(row.sessionId)
      if (leaseLiveAt({ lease, now: params.now })) return false
      if (lease !== undefined && lease.holderId !== null) return true
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
    .slice(0, params.limit)
    .map((row) => row.sessionId)
}
