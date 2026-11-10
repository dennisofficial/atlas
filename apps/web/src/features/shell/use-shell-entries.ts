'use client'

import { useEffect, useMemo, useRef } from 'react'

import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { applyActivityOverrides, useActivityOverrides } from './activity-overrides'
import { useCreatedThreads, withCreatedThreads } from './created-threads'
import type { ShellThreads } from './live-list'
import { hasThread } from './thread-partition'
import { useLiveList } from './use-live-list'
import { useV2Sessions } from './use-v2-sessions'
import { withV2Sessions } from './v2-rows'

export function useShellEntries(activeThreadId: string | null): CloudQuery<ShellThreads> {
  const query = useLiveList()
  const created = useCreatedThreads()
  const overrides = useActivityOverrides()
  const v2Sessions = useV2Sessions()
  const reloadedFor = useRef<string | null>(null)
  const { reload } = query
  const data = query.data

  useEffect(() => {
    if (data === undefined || activeThreadId === null) return
    if (hasThread({ entries: data.entries, threadId: activeThreadId })) return
    if (reloadedFor.current === activeThreadId) return
    reloadedFor.current = activeThreadId
    reload()
  }, [data, activeThreadId, reload])

  const merged = useMemo(() => {
    if (data === undefined) return undefined
    const withCreated = withCreatedThreads({ entries: data.entries, created })
    const withV2 = withV2Sessions({ entries: withCreated, sessions: v2Sessions })
    return { entries: applyActivityOverrides({ entries: withV2, overrides }), counts: data.counts }
  }, [data, created, overrides, v2Sessions])
  if (query.state !== EQueryState.Ready || merged === undefined) {
    return query.state === EQueryState.Failed
      ? query
      : {
          state: EQueryState.Loading,
          data: undefined,
          error: undefined,
          reload,
        }
  }
  return { state: EQueryState.Ready, data: merged, error: undefined, reload }
}
