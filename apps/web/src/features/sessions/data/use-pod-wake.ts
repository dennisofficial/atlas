'use client'

import { useCallback, useEffect, useState } from 'react'

export const WAKE_TIMEOUT_MS = 300_000

export type PodWakeState = 'asleep' | 'waking' | 'timeout' | 'elsewhere'

export function nextPodWakeState(args: {
  previous: PodWakeState
  event: 'wake' | 'live' | 'timeout' | 'elsewhere' | 'gone'
}): PodWakeState {
  if (args.event === 'live' || args.event === 'gone') return 'asleep'
  if (args.event === 'timeout') return args.previous === 'waking' ? 'timeout' : args.previous
  if (args.event === 'elsewhere') return 'elsewhere'
  return 'waking'
}

export function usePodWake(args: {
  sessionId: string
  live: boolean
  wake: () => Promise<void>
  timeoutMs?: number
}): { state: PodWakeState; wakePod: () => void } {
  const { sessionId, live, wake } = args
  const timeoutMs = args.timeoutMs ?? WAKE_TIMEOUT_MS
  const [local, setLocal] = useState<PodWakeState | 'idle'>('idle')
  const [liveBefore, setLiveBefore] = useState(live)

  useEffect(() => {
    if (live !== liveBefore) {
      setLiveBefore(live)
      if (live) setLocal('idle')
    }
  }, [live, liveBefore])

  useEffect(() => {
    setLocal('idle')
  }, [sessionId])

  useEffect(() => {
    if (local !== 'waking') return undefined
    const timer = setTimeout(() => setLocal('timeout'), timeoutMs)
    return () => clearTimeout(timer)
  }, [local, timeoutMs])

  const wakePod = useCallback(() => {
    if (local === 'waking') return
    setLocal('waking')
    wake().then(
      () => undefined,
      () => setLocal('timeout'),
    )
  }, [local, wake])

  if (live) return { state: 'asleep', wakePod }
  return { state: local === 'idle' ? 'asleep' : local, wakePod }
}
