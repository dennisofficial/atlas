import { actionableInboxIds, type InboxEntry, type Lease } from '@dltech/atlas-core'

import { asksForHolderOf } from '../../claim-ops'
import { activeFailureOf, hasPrepareHistory, idleHeadOf, type State } from './memory-state'

const childThreadIsLive = (params: { state: State; threadId: InboxEntry['threadId'] }): boolean =>
  params.threadId !== null && (params.state.events.get(params.threadId) ?? []).length > 0

const targetedDemandOf = (params: { state: State; entries: readonly InboxEntry[] }): boolean =>
  params.entries.some((entry) =>
    childThreadIsLive({ state: params.state, threadId: entry.threadId }),
  )

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
        (entry) => entry.consumedSeq === null && asksForHolderOf(entry.kind),
      )
      const head = Math.max(idleHeadOf(events), activeFailureOf(events)?.inboxHead ?? 0)
      const actionable = actionableInboxIds({
        entries: unconsumed.filter((entry) => entry.threadId === null),
        failure: { inboxHead: head },
      })
      return (
        actionable.length > 0 ||
        targetedDemandOf({ state, entries: unconsumed }) ||
        !hasPrepareHistory(events)
      )
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
