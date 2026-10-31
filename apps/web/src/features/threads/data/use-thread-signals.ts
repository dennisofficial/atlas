import { useEffect, useMemo } from 'react'

import { usePageVisible } from '@/lib/use-page-visible'

import { createThreadSignalHub, type ThreadSignalHub } from './thread-signal-hub'
import { createThreadSignals } from './thread-signals'
import { useThreadBackend } from './use-thread-backend'

export function useThreadSignals(threadId: string): ThreadSignalHub {
  const { subscribeStream } = useThreadBackend()
  const state = useMemo<{ threadId: string; hub: ThreadSignalHub; cursor: string | undefined }>(
    () => ({ threadId, hub: createThreadSignalHub(), cursor: undefined }),
    [threadId],
  )
  const { hub } = state
  const visible = usePageVisible()

  useEffect(() => {
    if (!visible) return undefined
    const signals = createThreadSignals({
      threadId,
      subscribe: subscribeStream,
      onHead: hub.emitHead,
      onCheckpoint: hub.emitCheckpoint,
      onEvents: hub.emitEvents,
      onReset: hub.emitReset,
      lastEventId: state.cursor,
      onCursor: (cursor) => {
        state.cursor = cursor
      },
      onPod: hub.emitPod,
      onMeta: hub.emitMeta,
      onStarted: hub.emitStarted,
    })
    signals.start()
    return signals.stop
  }, [threadId, hub, state, visible, subscribeStream])

  return hub
}
