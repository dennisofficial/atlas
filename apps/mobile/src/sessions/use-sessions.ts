import { createSessionsFeed, type SessionsFeed } from '@dltech/atlas-client/stream'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/auth-provider'
import { sessionStream } from '../thread/v2/session-stream'
import { type LoadedSessions, loadSessions } from './load-sessions'
import { type ISessionPartition, partitionSessions } from './session-groups'

export enum ELoadState {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

const EMPTY: ISessionPartition = { groups: [], inactive: [], archived: [] }

export const useSessions = () => {
  const { api } = useAuth()
  const [loaded, setLoaded] = useState<LoadedSessions | undefined>(undefined)
  const [live, setLive] = useState<readonly StreamSessionRow[] | undefined>(undefined)
  const [loadState, setLoadState] = useState(ELoadState.Loading)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const feedRef = useRef<SessionsFeed | undefined>(undefined)

  useEffect(() => {
    if (api === undefined) return undefined
    feedRef.current ??= createSessionsFeed({
      follow: () => sessionStream().followSessions(),
      write: setLive,
    })
    return feedRef.current.retain()
  }, [api])

  const load = useCallback(async () => {
    if (api === undefined) return
    const loadedAt = Date.now()
    try {
      setLoaded(await loadSessions({ api }))
      setLive(undefined)
      setNow(loadedAt)
      setLoadState(ELoadState.Ready)
    } catch {
      setLoadState((current) => (current === ELoadState.Ready ? current : ELoadState.Failed))
    }
  }, [api])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const partition = useMemo(
    () =>
      loaded === undefined
        ? EMPTY
        : partitionSessions({
            projects: loaded.projects,
            threads: loaded.threads,
            sessions: live ?? loaded.sessions,
            now,
          }),
    [loaded, live, now],
  )

  return { partition, loadState, refreshing, refresh, now }
}
