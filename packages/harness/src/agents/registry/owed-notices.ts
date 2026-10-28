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
    })
  }
}
