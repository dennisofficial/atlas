import {
  resumeDraftsOf,
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
  const { threadId } = args
  const state = await args.record.loopState({ threadId })
  const expand = args.expandContext
  const unanswered =
    expand === undefined
      ? []
      : unexpandedSkillDrafts({
          events: await args.record.ownEvents({ threadId, afterSeq: state.lastAssistant?.seq }),
          expand,
        })
  const drafts = [...unanswered, ...resumeDraftsOf(state)]
  if (drafts.length === 0) return drafts

  await args.record.append({ threadId: args.threadId, runId: args.ids.nextRunId(), drafts })
  return drafts
}
