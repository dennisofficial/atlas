import { useLiveThread } from './use-live-thread'
import { useThreadEvents } from './use-thread-events'
import type { ThreadModelChoice } from './live-thread-view'
import { pollingEnabledFor, threadSourceOf, type ThreadSource } from './thread-source'

export type { ThreadSource } from './thread-source'

export function useThreadSource(args: {
  threadId: string
  liveEligible: boolean
  onModelChanged?: ((model: ThreadModelChoice) => void) | undefined
}): ThreadSource {
  const live = useLiveThread({
    threadId: args.threadId,
    active: args.liveEligible,
    onModelChanged: args.onModelChanged,
  })
  const polled = useThreadEvents(args.threadId, pollingEnabledFor(live))
  return threadSourceOf({ live, polled })
}
