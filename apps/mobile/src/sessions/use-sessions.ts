import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'

import { useAuth } from '../auth/auth-provider'
import { loadSessions } from './load-sessions'
import type { ISessionPartition } from './session-groups'

export enum ELoadState {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

const EMPTY: ISessionPartition = { groups: [], inactive: [], archived: [] }

export const useSessions = () => {
  const { api } = useAuth()
  const [partition, setPartition] = useState(EMPTY)
  const [loadState, setLoadState] = useState(ELoadState.Loading)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    if (api === undefined) return
    const loadedAt = Date.now()
    try {
      setPartition(await loadSessions({ api, now: loadedAt }))
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

  return { partition, loadState, refreshing, refresh, now }
}
