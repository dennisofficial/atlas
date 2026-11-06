'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import {
  ESessionConnection,
  type FollowedSession,
  type SessionCache,
  type SessionSnapshot,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

const NOT_FOLLOWING: SessionSnapshot = {
  events: [],
  cursor: undefined,
  status: undefined,
  overlay: undefined,
  connection: ESessionConnection.Reconnecting,
}

const notFollowingSnapshot = (): SessionSnapshot => NOT_FOLLOWING

export function useSessionStream({
  sessionId,
  connection,
  cache,
}: {
  sessionId: string
  connection: () => StreamConnection
  cache: SessionCache
}): SessionSnapshot {
  const [followed, setFollowed] = useState<FollowedSession | undefined>(undefined)

  useEffect(() => {
    const session = connection().follow({ sessionId, cache })
    setFollowed(session)
    return () => {
      session.close()
      setFollowed(undefined)
    }
  }, [connection, sessionId, cache])

  const subscribe = useCallback(
    (listener: () => void) => followed?.subscribe(listener) ?? (() => undefined),
    [followed],
  )
  const getSnapshot = followed?.getSnapshot ?? notFollowingSnapshot
  return useSyncExternalStore(subscribe, getSnapshot, notFollowingSnapshot)
}
