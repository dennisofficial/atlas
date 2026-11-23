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
}): { state: PodWakeState; message: string | undefined; wakePod: () => void } {
  const { sessionId, live, wake } = args
  const timeoutMs = args.timeoutMs ?? WAKE_TIMEOUT_MS
  const [local, setLocal] = useState<PodWakeState | 'idle'>('idle')
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [liveBefore, setLiveBefore] = useState(live)

  useEffect(() => {
    if (live !== liveBefore) {
      setLiveBefore(live)
      if (live) {
        setLocal('idle')
        setMessage(undefined)
      }
    }
  }, [live, liveBefore])

  useEffect(() => {
    setLocal('idle')
    setMessage(undefined)
  }, [sessionId])

  useEffect(() => {
    if (local !== 'waking') return undefined
    const timer = setTimeout(() => setLocal('timeout'), timeoutMs)
    return () => clearTimeout(timer)
  }, [local, timeoutMs])

  const wakePod = useCallback(() => {
    if (local === 'waking') return
    setMessage(undefined)
    setLocal('waking')
    wake().then(
      () => undefined,
      (failure: unknown) => {
        setMessage(failure instanceof Error ? failure.message : undefined)
        setLocal('timeout')
      },
    )
  }, [local, wake])

  if (live) return { state: 'asleep', message, wakePod }
  return { state: local === 'idle' ? 'asleep' : local, message, wakePod }
}
