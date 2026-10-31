import { useEffect } from 'react'

import { activityOverrides } from '@/features/shell/activity-overrides'

import { useLiveThread } from './use-live-thread'
import { useThreadEvents } from './use-thread-events'
import { useThreadBackend } from './use-thread-backend'
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
  const { threadId } = args
  const backend = useThreadBackend()
  const live = useLiveThread({
    threadId,
    active: backend.local || args.liveEligible,
    onModelChanged: args.onModelChanged,
  })
  const polled = useThreadEvents({
    threadId,
    signals: args.signals,
    enabled: pollingEnabledFor(live),
  })
  const liveWorking = live.live && live.working
  useEffect(() => {
    if (!liveWorking) return undefined
    activityOverrides.markWorking(threadId)
    return () => activityOverrides.clearPending(threadId)
  }, [liveWorking, threadId])
  return threadSourceOf({ live, polled })
}
