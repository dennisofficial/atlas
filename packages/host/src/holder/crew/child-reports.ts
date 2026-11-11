import {
  agentEnding,
  EAgentStatus,
  EKilledBy,
  EMessageOrigin,
  EReportKind,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'
import type { Progress } from './child-progress'

export type ChildParent = {
  deps: HeldSessionDeps
  record: SessionRecord
  threadId: ThreadId
  agentId: ThreadId
  agentType: string
  intent: string
}

export const appendOnParent = async (
  parent: ChildParent,
  drafts: readonly EventDraft[],
): Promise<void> => {
  await parent.record.append({
    threadId: parent.threadId,
    runId: parent.deps.ids.nextRunId(),
    drafts,
  })
}

export const wakeParent = async (parent: ChildParent, text: string): Promise<void> => {
  await parent.deps.plane.post({
    sessionId: parent.deps.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text, via: EMessageOrigin.ChildAgent }),
  })
}

const named = (parent: ChildParent): string =>
  `Sub-agent ${parent.agentId} (${parent.agentType}, "${parent.intent}")`

export const reportTextOf = (parent: ChildParent, kind: EReportKind): string =>
  `${named(parent)} reported ${kind}.`

export const endingTextOf = (args: {
  parent: ChildParent
  progress: Progress
  status: EAgentStatus
  failure: string | undefined
  killedBy: EKilledBy | undefined
}): string => {
  const ending = agentEnding({
    status: args.status,
    turns: args.progress.turns,
    toolCalls: args.progress.toolCalls,
    ...(args.killedBy === undefined ? {} : { killedBy: args.killedBy }),
    ...(args.failure === undefined ? {} : { failureCause: args.failure }),
  })
  return `${named(args.parent)} ${ending}.`
}
