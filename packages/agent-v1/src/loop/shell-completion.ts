import { rowsOwnedBy, shellCompletionNudge, type RunId, type ThreadId } from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'

export async function appendShellCompletionNudge(args: {
  record: AgentRecordPort
  threadId: ThreadId
  runId: RunId
  seenThrough: number | undefined
}): Promise<void> {
  const events = rowsOwnedBy({
    events: await args.record.composedEvents({ threadId: args.threadId }),
    threadId: args.threadId,
  })
  const nudge = shellCompletionNudge({ events, seenThrough: args.seenThrough })
  if (nudge === undefined) return
  await args.record.append({ threadId: args.threadId, runId: args.runId, drafts: [nudge] })
}
