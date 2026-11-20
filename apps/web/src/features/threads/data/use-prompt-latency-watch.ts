import { useEffect } from 'react'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { promptLatency, type PromptLatency } from './prompt-latency'
import type { ThreadSignalHub } from './thread-signal-hub'

export function usePromptLatencyWatch(args: {
  threadId: string
  signals: ThreadSignalHub
  events: readonly WireEvent[]
  latency?: PromptLatency
}): void {
  const { threadId, signals, events, latency = promptLatency } = args
  useEffect(() => {
    latency.sawEvents({ threadId, events })
  }, [latency, threadId, events])
  useEffect(
    () =>
      signals.listen({
        onMeta: ({ thread }) => {
          if (thread.id !== threadId) return
          if (thread.status?.working !== true) return
          latency.turnStarted({ threadId })
        },
      }),
    [latency, signals, threadId],
  )
}
