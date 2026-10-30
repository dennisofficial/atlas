'use client'

import { useEffect, useMemo, useRef } from 'react'

import { listLocalPods } from '@/features/desktop/desktop-wire'
import { withLocalPods } from '@/features/desktop/local-thread'
import { fetchProjects, fetchSessions } from '@/features/threads/data/threads-api'
import { EQueryState, useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import {
  activityOverrides,
  applyActivityOverrides,
  useActivityOverrides,
} from './activity-overrides'
import { createdThreads, useCreatedThreads, withCreatedThreads } from './created-threads'
import { useListSignals } from './use-list-signals'
import { hasThread, type ProjectThreads } from './thread-partition'

type ShellLoad = { entries: ProjectThreads[]; startedAt: number }

async function loadShellEntries(): Promise<ShellLoad> {
  const startedAt = Date.now()
  const projects = await fetchProjects()
  const [lists, projectless, pods] = await Promise.all([
    Promise.all(projects.map((project) => fetchSessions(project.id))),
    fetchSessions(null),
    listLocalPods(),
  ])
  const entries: ProjectThreads[] = [
    ...projects.map((project, index) => ({
      project,
      sessions: lists[index] ?? [],
    })),
    { project: null, sessions: projectless },
  ]
  return { entries: withLocalPods({ entries, pods }), startedAt }
}

export function useShellEntries(activeThreadId: string | null): CloudQuery<ProjectThreads[]> {
  const query = useCloudQuery({ key: 'shell-threads', load: loadShellEntries })
  const created = useCreatedThreads()
  const overrides = useActivityOverrides()
  const reloadedFor = useRef<string | null>(null)
  const { reload } = query
  const loaded = query.data
  const data = loaded?.entries
  useListSignals({ reload })

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
    const withCreated = withCreatedThreads({ entries: data, created })
    return applyActivityOverrides({ entries: withCreated, overrides })
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
