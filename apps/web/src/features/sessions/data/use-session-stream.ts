'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  ESessionConnection,
  type FollowedSession,
  type SessionLog,
  type SessionSnapshot,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

const NOT_FOLLOWING: SessionSnapshot = {
  events: [],
  pending: { pending: [] },
  cursor: undefined,
  status: undefined,
  overlay: undefined,
  shells: {},
  connection: ESessionConnection.Reconnecting,
  error: undefined,
  skipped: 0,
  writerAhead: false,
  fromCache: false,
}

const notFollowingSnapshot = (): SessionSnapshot => NOT_FOLLOWING

export type SessionStream = {
  snapshot: SessionSnapshot
  loadOlder: () => Promise<number>
}

export function useSessionStream({
  sessionId,
  threadId,
  connection,
  log,
}: {
  sessionId: string
  threadId?: string | undefined
  connection: () => StreamConnection
  log: SessionLog
}): SessionStream {
  const [followed, setFollowed] = useState<FollowedSession | undefined>(undefined)
  const followedRef = useRef<FollowedSession | undefined>(undefined)

  useEffect(() => {
    const session = connection().follow({ sessionId, threadId, log })
    followedRef.current = session
    setFollowed(session)
    return () => {
      followedRef.current = undefined
      session.close()
      setFollowed(undefined)
    }
  }, [connection, sessionId, threadId, log])

  const subscribe = useCallback(
    (listener: () => void) => followed?.subscribe(listener) ?? (() => undefined),
    [followed],
  )
  const getSnapshot = followed?.getSnapshot ?? notFollowingSnapshot
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, notFollowingSnapshot)
  const loadOlder = useCallback(() => followedRef.current?.loadOlder() ?? Promise.resolve(0), [])
  return { snapshot, loadOlder }
}
