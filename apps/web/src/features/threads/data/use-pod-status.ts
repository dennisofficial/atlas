import { useCallback, useEffect, useRef, useState } from 'react'

import type { PodStatus } from '@dltech/atlas-wire/web'

import { createPodStatusReader } from './pod-status-reader'
import type { ThreadSignalHub } from './thread-signal-hub'
import { fetchPod } from './threads-api'

const NOT_READING = () => undefined

export function usePodStatus(args: { threadId: string; signals: ThreadSignalHub }): {
  pod: PodStatus | null
  refresh: () => void
} {
  const { threadId, signals } = args
  const [pod, setPod] = useState<PodStatus | null>(null)
  const refreshRef = useRef<() => void>(NOT_READING)

  useEffect(() => {
    const reader = createPodStatusReader({ threadId, fetchPod, onPod: setPod })
    const unlisten = signals.listen({ onPod: reader.refresh, onStarted: reader.refresh })
    refreshRef.current = reader.refresh
    reader.refresh()
    return () => {
      refreshRef.current = NOT_READING
      unlisten()
      reader.stop()
    }
  }, [threadId, signals])

  const refresh = useCallback(() => refreshRef.current(), [])
  return { pod, refresh }
}
