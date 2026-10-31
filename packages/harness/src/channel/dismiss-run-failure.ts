import type { EventLogPort, RunId, ThreadId } from '@dltech/atlas-core'

export async function dismissRunFailure(args: {
  log: Pick<EventLogPort, 'append'>
  threadId: ThreadId
  runId: RunId
  failureSeq: number
}): Promise<void> {
  await args.log.append({
    threadId: args.threadId,
    runId: args.runId,
    drafts: [{ type: 'run-failure-dismissed', failureSeq: args.failureSeq }],
  })
}
