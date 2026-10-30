import { deliveredDraftOf, owedNotices, type Event, type ThreadId } from '@dltech/atlas-core'

import { EAgentNotice, type AgentNoticeQueue } from './notices'
import type { AgentRoster } from './roster'
import { snapshotOf } from './child-state'

export function requeueOwedNotices({
  events,
  threadId,
  roster,
  notices,
}: {
  events: readonly Event[]
  threadId: ThreadId
  roster: AgentRoster
  notices: AgentNoticeQueue
}): void {
  for (const arrival of owedNotices(events)) {
    if (arrival.threadId !== threadId) continue
    if (arrival.type !== 'agent-ended' && arrival.type !== 'agent-reported') continue

    const child = roster.find(arrival.agentId)
    const draft = deliveredDraftOf(arrival)
    if (child === undefined || draft === undefined) continue

    notices.requeue({
      threadId,
      snapshot: snapshotOf(child),
      kind: arrival.type === 'agent-ended' ? EAgentNotice.Ending : EAgentNotice.Report,
      draft,
      generation: child.abort.signal,
    })
  }
}

export function stampSettledDeliveries({
  events,
  threadId,
  roster,
}: {
  events: readonly Event[]
  threadId: ThreadId
  roster: AgentRoster
}): void {
  const awaiting = new Set(
    owedNotices(events)
      .filter((arrival) => arrival.threadId === threadId && arrival.type === 'agent-ended')
      .flatMap((arrival) => (arrival.type === 'agent-ended' ? [arrival.agentId] : [])),
  )

  let stamped = false
  for (const child of roster.states()) {
    if (child.spawnedBy !== threadId || child.endedAt === undefined) continue
    if (child.deliveredAt !== undefined || awaiting.has(child.agentId)) continue
    child.deliveredAt = child.endedAt
    stamped = true
  }
  if (stamped) roster.changed()
}
