import { useCallback, useEffect, useState } from 'react'

import type { PodStatus } from '@dltech/atlas-wire/web'

import { shouldPollPod } from './boot-view'
import { fetchPod } from './threads-api'

const POLL_MS = 2000

export function usePodStatus(args: {
  threadId: string
  awaitingRun: boolean
  watchingPark: boolean
}): {
  pod: PodStatus | null
  refresh: () => void
} {
  const { threadId, awaitingRun, watchingPark } = args
  const [pod, setPod] = useState<PodStatus | null>(null)
  const [kick, setKick] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const next = await fetchPod(threadId)
        if (cancelled) return
        setPod(next)
        if (!shouldPollPod({ pod: next, awaitingRun, watchingPark })) return
      } catch {
        if (cancelled) return
      }
      timer = setTimeout(() => void poll(), POLL_MS)
    }

    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [threadId, awaitingRun, watchingPark, kick])

  const refresh = useCallback(() => setKick((count) => count + 1), [])
  return { pod, refresh }
}
