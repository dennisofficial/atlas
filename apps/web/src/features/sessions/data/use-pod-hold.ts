'use client'

import { useEffect } from 'react'

import { api, cloudCall } from '@/lib/api-client'

export const POD_HOLD_HEARTBEAT_MS = 20_000

export const holdPod = (sessionId: string): Promise<unknown> =>
  cloudCall(api.sessions.holdPod.mutate({ sessionId }))

export function usePodHold(args: {
  sessionId: string
  active: boolean
  intervalMs?: number
  hold?: (sessionId: string) => Promise<unknown>
}): void {
  const { sessionId, active } = args
  const intervalMs = args.intervalMs ?? POD_HOLD_HEARTBEAT_MS
  const hold = args.hold ?? holdPod

  useEffect(() => {
    if (!active) return undefined
    const beat = (): void => {
      if (document.visibilityState !== 'visible') return
      void hold(sessionId).catch(() => undefined)
    }
    beat()
    const timer = setInterval(beat, intervalMs)
    document.addEventListener('visibilitychange', beat)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [sessionId, active, intervalMs, hold])
}
