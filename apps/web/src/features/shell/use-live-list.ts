'use client'

import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { listLocalPods } from '@/features/desktop/desktop-wire'
import { subscribeThreadsLive } from '@/features/threads/data/threads-api'
import { PROJECTS_KEY, SHELL_THREADS_KEY } from '@/lib/cloud-keys'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'
import { usePageVisible } from '@/lib/use-page-visible'

import { activityOverrides } from './activity-overrides'
import { createdThreads } from './created-threads'
import { createLiveListPublisher } from './live-list-publisher'
import { createThreadsLive } from './live-stream'
import { readSidebarCache, writeSidebarCache } from './sidebar-cache'
import type { ProjectThreads } from './thread-partition'

type ShellThreadsBox = { value: { entries: ProjectThreads[]; startedAt: number } }

const CACHE_STARTED_AT = 0

export function useLiveList(): CloudQuery<ProjectThreads[]> {
  const queryClient = useQueryClient()
  const visible = usePageVisible()
  const live = useRef<ReturnType<typeof createThreadsLive> | undefined>(undefined)

  const publish = useCallback(
    ({
      applied,
      entries,
    }: Parameters<Parameters<typeof createLiveListPublisher>[0]['publish']>[0]) => {
      createdThreads.forgetListed(entries)
      activityOverrides.settleBefore(applied.at)
      queryClient.setQueryData([SHELL_THREADS_KEY], {
        value: { entries, startedAt: applied.at },
      })
      queryClient.setQueryData([PROJECTS_KEY], {
        value: [...applied.state.projects.values()],
      })
      writeSidebarCache(entries)
    },
    [queryClient],
  )
  const publishRef = useRef(publish)
  publishRef.current = publish

  useLayoutEffect(() => {
    if (queryClient.getQueryData([SHELL_THREADS_KEY]) !== undefined) return
    const cached = readSidebarCache()
    if (cached === undefined) return
    queryClient.setQueryData<ShellThreadsBox>([SHELL_THREADS_KEY], {
      value: { entries: cached, startedAt: CACHE_STARTED_AT },
    })
  }, [queryClient])

  useEffect(() => {
    if (!visible) return undefined
    const publisher = createLiveListPublisher({
      loadPods: listLocalPods,
      publish: (update) => publishRef.current(update),
    })
    const stream = createThreadsLive({
      subscribe: subscribeThreadsLive,
      onApplied: publisher.apply,
    })
    live.current = stream
    stream.start()
    return () => {
      live.current = undefined
      publisher.stop()
      stream.stop()
    }
  }, [visible])

  const reload = useCallback(() => {
    live.current?.reopen()
  }, [])

  const query = useQuery<ShellThreadsBox>({ queryKey: [SHELL_THREADS_KEY], queryFn: skipToken })
  if (query.data !== undefined) {
    return { state: EQueryState.Ready, data: query.data.value.entries, error: undefined, reload }
  }
  return { state: EQueryState.Loading, data: undefined, error: undefined, reload }
}
