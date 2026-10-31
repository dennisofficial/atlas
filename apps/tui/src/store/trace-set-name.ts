import type { ThreadId } from '@dltech/atlas-core'

import { durableOpLog } from '../composition/durable-op-log'

export function traceSetName(args: {
  threadId: ThreadId
  from: string | null
  to: string | null
}): void {
  if (process.env.ATLAS_TRACE_TITLING === undefined) return
  durableOpLog()?.info({
    source: 'titling.trace',
    message: 'conversation-store setName',
    threadId: args.threadId,
    data: { from: args.from, to: args.to },
  })
}
