import {
  resumeDrafts,
  unexpandedSkillDrafts,
  type EventDraft,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'

import type { ExpandContext } from '../intake/pending-said'

export async function appendResumeDrafts(args: {
  record: AgentRecordPort
  ids: IdPort
  threadId: ThreadId
  expandContext?: ExpandContext | undefined
}): Promise<readonly EventDraft[]> {
  const events = await args.record.composedEvents({ threadId: args.threadId })
  const expand = args.expandContext
  const drafts = [
    ...(expand === undefined ? [] : unexpandedSkillDrafts({ events, expand })),
    ...resumeDrafts(events),
  ]
  if (drafts.length === 0) return drafts

  await args.record.append({ threadId: args.threadId, runId: args.ids.nextRunId(), drafts })
  return drafts
}
