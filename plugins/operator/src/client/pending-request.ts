import type { OperatorRequestEntry } from '@dltech/atlas-client/transcript'
import type { Event, V2Event } from '@dltech/atlas-core'

import { requestEntriesAt } from './request-entry'

export const pendingOperatorRequestOf = (args: {
  events: readonly (Event | V2Event)[]
}): OperatorRequestEntry | null => {
  for (const entry of requestEntriesAt({ events: args.events }).values()) {
    if (entry.state === 'pending') return entry
  }

  return null
}
