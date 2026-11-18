import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { ApiClient } from '@dltech/atlas-api-router'
import {
  ESessionConnection,
  type FollowedSession,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import { sessionLog, sessionStream } from './session-stream'

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

export function useV2Session(args: { sessionId: string; api: ApiClient | undefined }): {
  snapshot: SessionSnapshot
  loadOlder: () => Promise<number>
} {
  const [followed, setFollowed] = useState<FollowedSession | undefined>(undefined)
  const followedRef = useRef<FollowedSession | undefined>(undefined)

  const { sessionId, api } = args

  useEffect(() => {
    if (api === undefined) return undefined
    const session = sessionStream(api).follow({ sessionId, log: sessionLog() })
    followedRef.current = session
    setFollowed(session)
    return () => {
      followedRef.current = undefined
      session.close()
      setFollowed(undefined)
    }
  }, [sessionId, api])

  const subscribe = useCallback(
    (listener: () => void) => followed?.subscribe(listener) ?? (() => undefined),
    [followed],
  )
  const snapshot = useSyncExternalStore(subscribe, followed?.getSnapshot ?? notFollowingSnapshot)
  const loadOlder = useCallback(() => followedRef.current?.loadOlder() ?? Promise.resolve(0), [])
  return { snapshot, loadOlder }
}
