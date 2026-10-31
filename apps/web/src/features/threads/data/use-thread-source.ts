import { useEffect, useMemo } from 'react'

import { activityOverrides } from '@/features/shell/activity-overrides'

import { createTranscriptHistory } from './transcript-history'
import { useThreadBackend } from './use-thread-backend'
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
  const { threadId } = args
  const backend = useThreadBackend()
  const history = useMemo(
    () =>
      createTranscriptHistory({
        threadId,
        fetchSeed: backend.fetchSeed,
        fetchSnapshot: backend.fetchSnapshot,
      }),
    [threadId, backend],
  )
  useEffect(
    () =>
      args.signals.listen({
        onCheckpoint: history.expectEpoch,
        onReset: history.expectEpoch,
        onEvents: history.expectEpoch,
      }),
    [args.signals, history],
  )
  const live = useLiveThread({
    threadId,
    history,
    active: args.liveEligible,
    onModelChanged: args.onModelChanged,
  })
  const polled = useThreadEvents({
    threadId,
    history,
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
