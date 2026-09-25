import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

/**
 * The integrity unit of a log transfer: the store that accepted the writes assigns seqs
 * transactionally, so reading the far side's head back says exactly how much of the batch landed.
 * A write that returns success but lands short is the silent-truncation case this exists to catch,
 * and seq+count equality catches it without a per-event diff.
 */
export async function assertTransferred(args: {
  log: EventLogPort
  threadId: ThreadId
  expectedHead: number
  expectedCount: number
  side: string
}): Promise<void> {
  const head = await args.log.head({ threadId: args.threadId })
  const count = (await args.log.readOwn({ threadId: args.threadId })).length

  if (head !== args.expectedHead || count !== args.expectedCount) {
    throw new Error(
      `the ${args.side} side of the transfer came back short — expected ${args.expectedCount} events with head ${args.expectedHead}, found ${count} with head ${head} — the move was aborted and nothing flipped`,
    )
  }
}
