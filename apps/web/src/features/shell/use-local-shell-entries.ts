'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { hasDesktopHost } from '@/features/desktop/desktop-http'
import { subscribeLocalThreadChanges } from '@/features/desktop/local-thread-feed'
import { listLocalThreads } from '@/features/desktop/local-thread-wire'
import { usePageVisible } from '@/lib/use-page-visible'

import { createLocalEntriesLoader, type LocalEntriesLoad } from './load-shell-entries'
import { useLocalListSignals } from './use-local-list-signals'

export const LOCAL_SHELL_THREADS_KEY = 'shell-local-threads'

export function useLocalShellEntries() {
  const client = useQueryClient()
  const visible = usePageVisible()
  const enabled = visible && hasDesktopHost()
  const load = useMemo(
    () =>
      createLocalEntriesLoader({
        load: listLocalThreads,
        previousThreads: client.getQueryData<LocalEntriesLoad>([LOCAL_SHELL_THREADS_KEY])?.threads,
      }),
    [client],
  )
  const query = useQuery({
    queryKey: [LOCAL_SHELL_THREADS_KEY],
    queryFn: load,
    enabled,
    retry: false,
    staleTime: Infinity,
  })
  const { refetch } = query
  const reload = useCallback(() => {
    if (visible && hasDesktopHost()) void refetch()
  }, [visible, refetch])
  useLocalListSignals({ visible, reload, subscribe: subscribeLocalThreadChanges })
  const reported = useRef(false)
  useEffect(() => {
    if (query.data === undefined) return
    const failure = query.data.error
    if (failure === null) {
      reported.current = false
      return
    }
    if (reported.current) return
    reported.current = true
    toast.error(
      `Couldn't refresh local threads: ${failure instanceof Error ? failure.message : String(failure)}`,
    )
  }, [query.data])
  return { data: query.data, reload }
}
