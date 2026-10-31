'use client'

import { useEffect, useMemo } from 'react'

import { withLocalThreads } from '@/features/desktop/local-thread'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { useActivityOverrides } from './activity-overrides'
import { createdThreads, useCreatedThreads } from './created-threads'
import { shellEntriesOf } from './load-shell-entries'
import type { ProjectThreads } from './thread-partition'
import { useLiveList } from './use-live-list'
import { useLocalShellEntries } from './use-local-shell-entries'

export function useShellEntries(_activeThreadId: string | null): CloudQuery<ProjectThreads[]> {
  const cloud = useLiveList()
  const local = useLocalShellEntries()
  const created = useCreatedThreads()
  const overrides = useActivityOverrides()
  const data = useMemo(() => {
    if (cloud.data === undefined && !local.data?.threads.length) return undefined
    return withLocalThreads({ entries: cloud.data ?? [], threads: local.data?.threads ?? [] })
  }, [cloud.data, local.data])

  useEffect(() => {
    if (data !== undefined) createdThreads.forgetListed(data)
  }, [data])

  const merged = useMemo(
    () => (data === undefined ? undefined : shellEntriesOf({ entries: data, created, overrides })),
    [data, created, overrides],
  )
  const reload = local.reload
  if (merged !== undefined)
    return { state: EQueryState.Ready, data: merged, error: undefined, reload }
  return cloud.state === EQueryState.Failed
    ? { ...cloud, reload }
    : { state: EQueryState.Loading, data: undefined, error: undefined, reload }
}
