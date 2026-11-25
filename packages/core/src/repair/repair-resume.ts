import type { ThreadId } from '../events/ids'
import type { RecordEvent } from '../record/event'
import { credentialRepairOf } from './repair-episode'

export const repairHoldsResume = (args: {
  mainThreadId: ThreadId
  events: readonly RecordEvent[]
}): boolean => credentialRepairOf(args)?.main === true
