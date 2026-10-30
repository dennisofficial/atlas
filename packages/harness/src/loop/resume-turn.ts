import {
  resumeDrafts,
  unexpandedSkillDrafts,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ExpandContext } from '../pending'

export async function appendResumeDrafts(args: {
  log: EventLogPort
  ids: IdPort
  threadId: ThreadId
  expandContext?: ExpandContext | undefined
}): Promise<readonly EventDraft[]> {
  const events = await args.log.read({ threadId: args.threadId })
  const expand = args.expandContext
  const drafts = [
    ...(expand === undefined ? [] : unexpandedSkillDrafts({ events, expand })),
    ...resumeDrafts(events),
  ]
  if (drafts.length === 0) return drafts

  await args.log.append({ threadId: args.threadId, runId: args.ids.nextRunId(), drafts })
  return drafts
}
