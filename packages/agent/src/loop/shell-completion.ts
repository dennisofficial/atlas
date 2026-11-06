import {
  awaitsReplyOf,
  shellCompletionNudgeFrom,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'

export async function appendShellCompletionNudge(args: {
  record: AgentRecordPort
  threadId: ThreadId
  runId: RunId
  seenThrough: number | undefined
}): Promise<void> {
  const { record, threadId, seenThrough } = args
  if (seenThrough === undefined) return
  const state = await record.loopState({ threadId })
  if (awaitsReplyOf(state)) return
  const lastAssistantSeq = state.lastAssistant?.seq
  const tail = await record.ownEvents({
    threadId,
    afterSeq: Math.min(seenThrough, lastAssistantSeq ?? 0),
  })
  const nudge = shellCompletionNudgeFrom({
    awaitingReply: false,
    lastAssistantSeq,
    tail,
    seenThrough,
  })
  if (nudge === undefined) return
  await record.append({ threadId, runId: args.runId, drafts: [nudge] })
}
