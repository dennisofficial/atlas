import {
  outstandingApproval,
  type Event,
  type EventLogPort,
  type ThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'

import { currentWaiting, isWaitingEvent } from './waiting'

const isApprovalEvent = (event: Event): boolean =>
  event.type === 'approval-requested' || event.type === 'approval-answered'

export function createApprovalWatcher(args: {
  threadId: ThreadId
  log: Pick<EventLogPort, 'readOwn' | 'head'>
  onChange: (waiting: boolean) => void
  onWaiting?: ((waiting: WaitingForModel | null) => void) | undefined
}): { refresh: () => void } {
  const { threadId, log } = args
  let seen = 0
  let approvals: Event[] = []
  let waits: Event[] = []
  let chain: Promise<void> = Promise.resolve()

  const read = async (): Promise<void> => {
    if ((await log.head({ threadId })) < seen) {
      seen = 0
      approvals = []
      waits = []
    }
    const fresh = await log.readOwn({ threadId, fromSeq: seen + 1 })
    for (const event of fresh) {
      if (event.seq <= seen) continue
      seen = event.seq
      if (isApprovalEvent(event)) approvals.push(event)
      if (isWaitingEvent(event)) waits.push(event)
    }
    args.onChange(outstandingApproval(approvals) !== undefined)
    args.onWaiting?.(currentWaiting(waits))
  }

  return {
    refresh: () => {
      chain = chain.then(read).catch(() => undefined)
    },
  }
}
