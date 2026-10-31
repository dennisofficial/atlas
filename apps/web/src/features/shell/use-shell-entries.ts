'use client'

import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { listLocalThreads } from '@/features/desktop/local-thread-wire'
import { fetchProjects, fetchSessions } from '@/features/threads/data/threads-api'
import { EQueryState, useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { activityOverrides, useActivityOverrides } from './activity-overrides'
import { createdThreads, useCreatedThreads } from './created-threads'
import { createShellEntriesLoader, shellEntriesOf } from './load-shell-entries'
import { useListSignals } from './use-list-signals'
import { hasThread, type ProjectThreads } from './thread-partition'
import { SHELL_THREADS_KEY } from '@/lib/cloud-keys'

async function loadCloudEntries(): Promise<ProjectThreads[]> {
  const projects = await fetchProjects()
  const [lists, projectless] = await Promise.all([
    Promise.all(projects.map((project) => fetchSessions(project.id))),
    fetchSessions(null),
  ])
  const entries: ProjectThreads[] = [
    ...projects.map((project, index) => ({
      project,
      sessions: lists[index] ?? [],
    })),
    { project: null, sessions: projectless },
  ]
  return entries
}

const loadEntries = createShellEntriesLoader({ cloud: loadCloudEntries, local: listLocalThreads })
const failureMessageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useShellEntries(activeThreadId: string | null): CloudQuery<ProjectThreads[]> {
  const query = useCloudQuery({ key: SHELL_THREADS_KEY, load: loadEntries })
  const created = useCreatedThreads()
  const overrides = useActivityOverrides()
  const reloadedFor = useRef<string | null>(null)
  const reportedAvailability = useRef<string | null>(null)
  const { reload } = query
  const loaded = query.data
  const data = loaded?.entries
  useListSignals({ reload })

  useEffect(() => {
    if (loaded === undefined) return
    if (loaded.localError === null) {
      reportedAvailability.current = null
      return
    }
    const availability = loaded.cloudError === null ? 'local' : 'both'
    if (reportedAvailability.current === availability) return
    reportedAvailability.current = availability
    const local = `Couldn't refresh local threads: ${failureMessageOf(loaded.localError)}`
    const cloud =
      loaded.cloudError === null
        ? ''
        : `. Cloud threads are also unavailable: ${failureMessageOf(loaded.cloudError)}`
    toast.error(`${local}${cloud}`)
  }, [loaded])

  useEffect(() => {
    if (loaded === undefined) return
    createdThreads.forgetListed(loaded.entries)
    activityOverrides.settleBefore(loaded.startedAt)
  }, [loaded])

  useEffect(() => {
    if (data === undefined || activeThreadId === null) return
    if (hasThread({ entries: data, threadId: activeThreadId })) return
    if (reloadedFor.current === activeThreadId) return
    reloadedFor.current = activeThreadId
    reload()
  }, [data, activeThreadId, reload])

  const merged = useMemo(() => {
    if (data === undefined) return undefined
    return shellEntriesOf({ entries: data, created, overrides })
  }, [data, created, overrides])
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
