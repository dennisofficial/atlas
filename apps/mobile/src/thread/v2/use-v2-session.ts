import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { ApiClient } from '@dltech/atlas-api-router'
import {
  ESessionConnection,
  memorySessionLog,
  type FollowedSession,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import { sessionLog, sessionStream } from './session-stream'

const NOT_FOLLOWING: SessionSnapshot = {
  events: [],
  foldable: [],
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

export function useV2Session(args: {
  sessionId: string
  threadId?: string | undefined
  api: ApiClient | undefined
}): {
  snapshot: SessionSnapshot
  loadOlder: () => Promise<number>
} {
  const [followed, setFollowed] = useState<FollowedSession | undefined>(undefined)
  const followedRef = useRef<FollowedSession | undefined>(undefined)

  const { sessionId, threadId, api } = args

  useEffect(() => {
    if (api === undefined) return undefined
    const log = threadId === undefined ? sessionLog() : memorySessionLog()
    const session = sessionStream(api).follow({ sessionId, threadId, log })
    followedRef.current = session
    setFollowed(session)
    return () => {
      followedRef.current = undefined
      session.close()
      setFollowed(undefined)
    }
  }, [sessionId, threadId, api])

  const subscribe = useCallback(
    (listener: () => void) => followed?.subscribe(listener) ?? (() => undefined),
    [followed],
  )
  const snapshot = useSyncExternalStore(subscribe, followed?.getSnapshot ?? notFollowingSnapshot)
  const loadOlder = useCallback(() => followedRef.current?.loadOlder() ?? Promise.resolve(0), [])
  return { snapshot, loadOlder }
}
