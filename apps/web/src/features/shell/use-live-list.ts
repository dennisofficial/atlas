'use client'

import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { listLocalPods } from '@/features/desktop/desktop-wire'
import { subscribeThreadsLive } from '@/features/threads/data/threads-api'
import { PROJECTS_KEY, SHELL_THREADS_KEY } from '@/lib/cloud-keys'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'
import { usePageVisible } from '@/lib/use-page-visible'

import { activityOverrides } from './activity-overrides'
import { createdThreads } from './created-threads'
import { createLiveListPublisher } from './live-list-publisher'
import { createThreadsLive } from './live-stream'
import type { ProjectThreads } from './thread-partition'

type ShellThreadsBox = { value: { entries: ProjectThreads[]; startedAt: number } }

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
    },
    [queryClient],
  )
  const publishRef = useRef(publish)
  publishRef.current = publish

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
