import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import {
  ESessionConnection,
  type FollowedSession,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import { sessionCache, sessionStream } from './session-stream'

const NOT_FOLLOWING: SessionSnapshot = {
  events: [],
  cursor: undefined,
  status: undefined,
  overlay: undefined,
  connection: ESessionConnection.Reconnecting,
  error: undefined,
  skipped: 0,
  writerAhead: false,
  fromCache: false,
}

const notFollowingSnapshot = (): SessionSnapshot => NOT_FOLLOWING

export function useV2Session(sessionId: string): SessionSnapshot {
  const [followed, setFollowed] = useState<FollowedSession | undefined>(undefined)

  useEffect(() => {
    const session = sessionStream().follow({ sessionId, cache: sessionCache() })
    setFollowed(session)
    return () => {
      session.close()
      setFollowed(undefined)
    }
  }, [sessionId])

  const subscribe = useCallback(
    (listener: () => void) => followed?.subscribe(listener) ?? (() => undefined),
    [followed],
  )
  return useSyncExternalStore(subscribe, followed?.getSnapshot ?? notFollowingSnapshot)
}
