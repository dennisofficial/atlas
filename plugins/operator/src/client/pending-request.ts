import type { OperatorRequestEntry } from '@dltech/atlas-client/transcript'
import type { Event, RecordEvent } from '@dltech/atlas-core'

import { requestEntriesAt } from './request-entry'

export const pendingOperatorRequestOf = (args: {
  events: readonly (Event | RecordEvent)[]
}): OperatorRequestEntry | null => {
  for (const entry of requestEntriesAt({ events: args.events }).values()) {
    if (entry.state === 'pending') return entry
  }

  return null
}
