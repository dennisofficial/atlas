import { ESessionConnection, sessionStateLineOf } from '@dltech/atlas-client/stream'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { v2ViewOf, type V2ThreadView } from './rows'
import { useV2Session } from './use-v2-session'

const TICK_MS = 1_000

export type V2SessionScreen = V2ThreadView & {
  now: number
  stateLine: string | null
  loaded: boolean
  fromCache: boolean
  catchingUp: boolean
  failedToLoad: boolean
  stale: boolean
  send: (message: { text: string }) => Promise<boolean>
  stop: () => void
  retry: () => void
}

export function useV2SessionScreen(sessionId: string): V2SessionScreen {
  const { api } = useAuth()
  const snapshot = useV2Session(sessionId)
  const [now, setNow] = useState(() => Date.now())
  const view = useMemo(() => v2ViewOf({ snapshot, now }), [snapshot, now])

  useEffect(() => {
    if (!view.working) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [view.working])

  const send = useCallback(
    async (message: { text: string }): Promise<boolean> => {
      const text = message.text.trim()
      if (api === undefined || text.length === 0) return false
      try {
        await api.sessions.post.mutate({ sessionId, text })
      } catch {
        return false
      }
      return true
    },
    [api, sessionId],
  )

  const stop = useCallback(() => {
    void api?.sessions.command.mutate({ sessionId, name: 'stop', args: {} }).catch(() => undefined)
  }, [api, sessionId])

  const retry = useCallback(() => {
    void api?.sessions.retry.mutate({ sessionId }).catch(() => undefined)
  }, [api, sessionId])

  return {
    ...view,
    now,
    stateLine: sessionStateLineOf(snapshot),
    loaded: snapshot.cursor !== undefined || snapshot.status !== undefined,
    fromCache: snapshot.fromCache,
    catchingUp: snapshot.fromCache && snapshot.connection !== ESessionConnection.Live,
    failedToLoad: snapshot.error !== undefined,
    stale: snapshot.skipped > 0,
    send,
    stop,
    retry,
  }
}
