import type { Event, EventLogPort, ThreadId } from '@dltech/atlas-core'
import { rewindThread, type AgentRegistryPort, type ThreadStorePort } from '@dltech/atlas-harness'

import type { PendingSaid } from '../store'

type Said = Extract<Event, { type: 'user-said' }>

const wasSaid = (event: Event | undefined): event is Said => event?.type === 'user-said'

export enum ETakeBack {
  Taken = 'taken',
  Interrupted = 'interrupted',
  Nothing = 'nothing',
  TooLate = 'too-late',
}

export type TakeBack =
  | { type: ETakeBack.Taken; said: PendingSaid }
  | { type: ETakeBack.Interrupted }
  | { type: ETakeBack.Nothing }
  | { type: ETakeBack.TooLate }

/**
 * The queue holds only what was never delivered, so taking back something the loop already drained
 * means retracting it from the log. Only a trailing said qualifies: anything after it is the turn
 * answering, and the answer is what makes the edit a follow-up instead.
 */
export async function takeBackTrailingSaid(args: {
  log: EventLogPort
  threads: ThreadStorePort
  agents: AgentRegistryPort
  threadId: ThreadId
  interrupt?: () => void
}): Promise<TakeBack> {
  const owned = await args.log.readOwn({ threadId: args.threadId })
  const last = owned.at(-1)

  if (!wasSaid(last)) return { type: ETakeBack.Nothing }

  /**
   * A turn in flight has already assembled its request from this message, so deleting the row
   * would not stop the reply — the press becomes an interrupt instead, and the driver's settle
   * path rewinds the thread and hands the text back once the stream has actually stopped.
   */
  if (args.interrupt !== undefined) {
    args.interrupt()
    return { type: ETakeBack.Interrupted }
  }

  const rewound = await rewindThread({
    log: args.log,
    threads: args.threads,
    agents: args.agents,
    threadId: args.threadId,
    toSeq: last.seq - 1,
  })

  if (!rewound.ok) return { type: ETakeBack.TooLate }
  return { type: ETakeBack.Taken, said: { text: last.text, images: last.images ?? [] } }
}
