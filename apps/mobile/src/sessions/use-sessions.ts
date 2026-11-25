import { createSessionsFeed, gcSessionLog } from '@dltech/atlas-client/stream'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/auth-provider'
import { sessionLog } from '../thread/session/session-cache'
import { sessionStream } from '../thread/session/session-stream'
import { archiveStatesOf } from './archive-states'
import {
  applyArchiveOverrides,
  NO_ARCHIVE_OVERRIDES,
  settledArchiveOverrides,
  type TArchiveOverrides,
  withArchiveOverride,
} from './archive-overrides'
import { type LoadedSessions, loadSessions } from './load-sessions'
import { type ISessionPartition, partitionSessions } from './session-groups'

export enum ELoadState {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

const EMPTY: ISessionPartition = { groups: [], archived: [] }

export type TSetArchiveOverride = (args: {
  sessionId: string
  archivedAt: string | null | undefined
}) => void

export const useSessions = () => {
  const { api } = useAuth()
  const [loaded, setLoaded] = useState<LoadedSessions | undefined>(undefined)
  const [live, setLive] = useState<readonly StreamSessionRow[] | undefined>(undefined)
  const [loadState, setLoadState] = useState(ELoadState.Loading)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [archiveOverrides, setArchiveOverrides] = useState<TArchiveOverrides>(NO_ARCHIVE_OVERRIDES)

  useEffect(() => {
    if (api === undefined) return undefined
    return createSessionsFeed({
      follow: () => sessionStream(api).followSessions(),
      write: setLive,
    }).retain()
  }, [api])

  const load = useCallback(async () => {
    if (api === undefined) return
    const loadedAt = Date.now()
    try {
      const fresh = await loadSessions({ api })
      setLoaded(fresh)
      setArchiveOverrides((current) =>
        settledArchiveOverrides({ overrides: current, sessions: fresh.sessions }),
      )
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

  const setArchiveOverride: TSetArchiveOverride = useCallback(({ sessionId, archivedAt }) => {
    setArchiveOverrides((current) =>
      withArchiveOverride({ overrides: current, sessionId, archivedAt }),
    )
  }, [])

  const listed = live ?? loaded?.sessions
  useEffect(() => {
    if (listed === undefined) return
    void gcSessionLog({ log: sessionLog(), sessions: archiveStatesOf(listed) })
  }, [listed])

  const partition = useMemo(
    () =>
      loaded === undefined
        ? EMPTY
        : partitionSessions({
            projects: loaded.projects,
            sessions: applyArchiveOverrides({
              sessions: live ?? loaded.sessions,
              overrides: archiveOverrides,
            }),
            now,
          }),
    [loaded, live, now, archiveOverrides],
  )

  return { partition, loadState, refreshing, refresh, now, setArchiveOverride }
}
