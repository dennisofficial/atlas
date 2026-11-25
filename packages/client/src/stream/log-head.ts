import type { RecordEvent } from '@dltech/atlas-core'
import type { StreamServerMessage } from '@dltech/atlas-protocol'

import type { SessionCursor } from './session-window'

export const logHeadOf = (args: {
  message: Extract<StreamServerMessage, { type: 'events' }>
  fresh: readonly RecordEvent[]
}): SessionCursor => {
  const cursor = args.message.cursor
  const last = args.fresh[args.fresh.length - 1]
  return cursor !== undefined && cursor.seq === last?.seq ? cursor : args.message.head
}
