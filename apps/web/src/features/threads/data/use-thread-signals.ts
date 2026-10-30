import { useEffect, useState } from 'react'

import { usePageVisible } from '@/lib/use-page-visible'

import { createThreadSignalHub, type ThreadSignalHub } from './thread-signal-hub'
import { createThreadSignals } from './thread-signals'
import { useThreadBackend } from './use-thread-backend'

export function useThreadSignals(threadId: string): ThreadSignalHub {
  const { subscribeStream } = useThreadBackend()
  const [hub] = useState(createThreadSignalHub)
  const visible = usePageVisible()

  useEffect(() => {
    if (!visible) return undefined
    const signals = createThreadSignals({
      threadId,
      subscribe: subscribeStream,
      onHead: hub.emitHead,
      onPod: hub.emitPod,
      onTitle: hub.emitTitle,
      onStarted: hub.emitStarted,
    })
    signals.start()
    return signals.stop
  }, [threadId, hub, visible, subscribeStream])

  return hub
}
