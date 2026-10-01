import {
  rowsOwnedBy,
  shellCompletionNudge,
  type EventLogPort,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

export async function appendShellCompletionNudge(args: {
  log: EventLogPort
  threadId: ThreadId
  runId: RunId
  seenThrough: number | undefined
}): Promise<void> {
  const events = rowsOwnedBy({ events: await args.log.read({ threadId: args.threadId }), threadId: args.threadId })
  const nudge = shellCompletionNudge({ events, seenThrough: args.seenThrough })
  if (nudge === undefined) return
  await args.log.append({ threadId: args.threadId, runId: args.runId, drafts: [nudge] })
}
