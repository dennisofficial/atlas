import type { EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'
import type { MessageIntake } from '../intake'

type FlushInput = {
  intake: MessageIntake
  log: Pick<EventLogPort, 'append'>
  ids: Pick<IdPort, 'nextRunId'>
}

export async function flushThreadInput(args: FlushInput & { threadId: ThreadId }): Promise<boolean> {
  const batch = await args.intake.prepare({ threadId: args.threadId })
  try {
    if (batch.drafts.length > 0) {
      await args.log.append({ threadId: args.threadId, runId: args.ids.nextRunId(), drafts: batch.drafts })
    }
    batch.acknowledge()
    return batch.drafts.length > 0
  } finally {
    batch.release?.()
  }
}

export async function flushSessionInput(args: FlushInput): Promise<readonly ThreadId[]> {
  const written: ThreadId[] = []
  for (const threadId of args.intake.threadsWithPendingInput()) {
    if (await flushThreadInput({ ...args, threadId })) written.push(threadId)
  }
  return written
}
