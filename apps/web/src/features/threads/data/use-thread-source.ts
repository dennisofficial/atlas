import { useLiveThread } from './use-live-thread'
import { useThreadEvents } from './use-thread-events'
import { pollingEnabledFor, threadSourceOf, type ThreadSource } from './thread-source'

export type { ThreadSource } from './thread-source'

export function useThreadSource(args: { threadId: string; liveEligible: boolean }): ThreadSource {
  const live = useLiveThread({ threadId: args.threadId, active: args.liveEligible })
  const polled = useThreadEvents(args.threadId, pollingEnabledFor(live))
  return threadSourceOf({ live, polled })
}
