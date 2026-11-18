import { INBOX_KIND_AGENT_NOTICE, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'

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

export const wakeParent = async (parent: ChildParent): Promise<void> => {
  await parent.deps.plane.post({
    sessionId: parent.deps.sessionId,
    kind: INBOX_KIND_AGENT_NOTICE,
    payload: '{}',
  })
}
