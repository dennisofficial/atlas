import { useCallback, useEffect, useRef, useState } from 'react'

import type { SessionApi } from './session-api'

export enum EPodWake {
  Asleep = 'asleep',
  Waking = 'waking',
  Timeout = 'timeout',
  Elsewhere = 'elsewhere',
}

export const WAKE_TIMEOUT_MS = 300_000

export type PodWake = { state: EPodWake; handleWake: () => void }

export function useSessionWake(args: {
  api: SessionApi
  sessionId: string
  live: boolean
  timeoutMs?: number
}): PodWake {
  const { api, sessionId, live } = args
  const timeoutMs = args.timeoutMs ?? WAKE_TIMEOUT_MS
  const [local, setLocal] = useState<EPodWake | null>(null)
  const waking = useRef(false)
  waking.current = local === EPodWake.Waking

  useEffect(() => {
    setLocal(null)
  }, [sessionId])

  useEffect(() => {
    if (live) setLocal(null)
  }, [live])

  useEffect(() => {
    if (local !== EPodWake.Waking) return undefined
    const timer = setTimeout(() => setLocal(EPodWake.Timeout), timeoutMs)
    return () => clearTimeout(timer)
  }, [local, timeoutMs])

  const handleWake = useCallback(() => {
    if (waking.current) return
    setLocal(EPodWake.Waking)
    void api.wakePod({ sessionId }).then(
      (reply) => {
        if (reply.state === 'elsewhere') setLocal(EPodWake.Elsewhere)
      },
      () => {
        setLocal(EPodWake.Timeout)
      },
    )
  }, [api, sessionId])

  return { state: live ? EPodWake.Asleep : (local ?? EPodWake.Asleep), handleWake }
}
