import { useLiveThread } from './use-live-thread'
import { useThreadEvents } from './use-thread-events'
import type { ThreadModelChoice } from './live-thread-view'
import type { ThreadSignalHub } from './thread-signal-hub'
import { pollingEnabledFor, threadSourceOf, type ThreadSource } from './thread-source'

export type { ThreadSource } from './thread-source'

export function useThreadSource(args: {
  threadId: string
  signals: ThreadSignalHub
  liveEligible: boolean
  onModelChanged?: ((model: ThreadModelChoice) => void) | undefined
}): ThreadSource {
  const live = useLiveThread({
    threadId: args.threadId,
    active: args.liveEligible,
    onModelChanged: args.onModelChanged,
  })
  const polled = useThreadEvents({
    threadId: args.threadId,
    signals: args.signals,
    enabled: pollingEnabledFor(live),
  })
  return threadSourceOf({ live, polled })
}
