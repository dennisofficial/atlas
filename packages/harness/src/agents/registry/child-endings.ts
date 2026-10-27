import { EAgentStatus, EKilledBy } from '@dltech/atlas-core'

import type { AgentJournal } from './agent-journal'
import { agentEndedDraft, bookkeepingEndedDraft, snapshotOf, type ChildState } from './child-state'
import type { AgentNoticeQueue, EAgentNotice } from './notices'
import type { AgentRoster } from './roster'

const isRelocationPause = (child: ChildState): boolean =>
  child.status === EAgentStatus.Paused ||
  (child.status === EAgentStatus.Stopped && child.killedBy === EKilledBy.ContainerSwitch)

export async function recordEnding({
  journal,
  notices,
  roster,
  child,
  kind,
  leftServices,
}: {
  journal: AgentJournal
  notices: AgentNoticeQueue
  roster: AgentRoster
  child: ChildState
  kind: EAgentNotice | undefined
  leftServices: readonly string[]
}): Promise<void> {
  const ended = kind === undefined ? bookkeepingEndedDraft(child) : agentEndedDraft(child)
  const draft = leftServices.length === 0 ? ended : { ...ended, leftServices }
  const snapshot = snapshotOf(child)
  const generation = child.abort.signal

  const recorded = isRelocationPause(child)
    ? { recorded: false }
    : await journal.record({ threadId: child.spawnedBy, draft })
  if (roster.find(child.agentId) !== child) return

  if (kind === undefined) return

  notices.queue({
    threadId: child.spawnedBy,
    snapshot,
    kind,
    draft,
    generation,
    logged: recorded.recorded,
  })
}
