import type { ThreadId } from '../events/ids'
import type { V2Event } from '../record/event'
import { credentialRepairOf } from './repair-episode'

export const repairHoldsResume = (args: {
  mainThreadId: ThreadId
  events: readonly V2Event[]
}): boolean => credentialRepairOf(args)?.main === true
