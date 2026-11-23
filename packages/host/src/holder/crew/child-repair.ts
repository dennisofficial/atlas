import { isResumableOf, repairHoldsResume, type ThreadId } from '@dltech/atlas-core'

import type { SessionRecord } from '../record/record-adapter'

export const childResumeAllowed = (args: {
  agentId: ThreadId
  record: SessionRecord
  retry: boolean
}): boolean => {
  const cache = args.record.eventCache()
  return (
    isResumableOf(cache.loopState()) &&
    (args.retry || !repairHoldsResume({ mainThreadId: args.agentId, events: cache.eventsAfter(0) }))
  )
}
