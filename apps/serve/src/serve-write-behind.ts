import type { ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel } from '@dltech/atlas-harness'
import { isApiProvisioned } from '@dltech/atlas-wire'

import type { ServeApp } from './serve-app'
import { createEventFlusher, httpPostPodEvents, httpTruncatePodEvents } from './serve-event-flush'
import { mirrorHistoryEdits } from './serve-history-mirror'
import type { ServeLog } from './serve-log'

export type ServeWriteBehind = {
  flush: () => Promise<boolean>
  detach: () => void
}

export function bindServeWriteBehind(args: {
  env: Record<string, string | undefined>
  app: Pick<ServeApp, 'log' | 'rewind' | 'compaction'> & {
    channel: Pick<DeltaChannel, 'subscribe'>
  }
  threadId: ThreadId
  durableHead: number
  remote: { controlPlaneUrl: string; token: string; clientVersion: string; fetchFn: typeof fetch }
  log: ServeLog
}): ServeWriteBehind | undefined {
  if (!isApiProvisioned(args.env)) return undefined
  const flusher = createEventFlusher({
    threadId: args.threadId,
    events: args.app.log,
    durableHead: args.durableHead,
    post: httpPostPodEvents(args.remote),
    truncate: httpTruncatePodEvents(args.remote),
    log: args.log,
  })
  mirrorHistoryEdits({ app: args.app, threadId: args.threadId, flusher })
  const unsubscribe = args.app.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      const settled =
        signal.type === 'step-ended' ||
        signal.type === 'events-appended' ||
        (signal.type === 'turn-working' && !signal.working)
      if (settled) void flusher.flush()
    },
  })
  return { flush: flusher.flush, detach: unsubscribe }
}
