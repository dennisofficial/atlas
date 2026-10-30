'use client'

import { useEffect, useMemo, useRef } from 'react'

import { fetchProjects, fetchSessions } from '@/features/threads/data/threads-api'
import { EQueryState, useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { createdThreads, useCreatedThreads, withCreatedThreads } from './created-threads'
import { useListSignals } from './use-list-signals'
import { hasThread, type ProjectThreads } from './thread-partition'

async function loadShellEntries(): Promise<ProjectThreads[]> {
  const projects = await fetchProjects()
  const lists = await Promise.all(projects.map((project) => fetchSessions(project.id)))
  return projects.map((project, index) => ({ project, sessions: lists[index] ?? [] }))
}

export function useShellEntries(activeThreadId: string | null): CloudQuery<ProjectThreads[]> {
  const query = useCloudQuery({ key: 'shell-threads', load: loadShellEntries })
  const created = useCreatedThreads()
  const reloadedFor = useRef<string | null>(null)
  const { data, reload } = query
  useListSignals({ reload })

  useEffect(() => {
    if (data !== undefined) createdThreads.forgetListed(data)
  }, [data])

  useEffect(() => {
    if (data === undefined || activeThreadId === null) return
    if (hasThread({ entries: data, threadId: activeThreadId })) return
    if (reloadedFor.current === activeThreadId) return
    reloadedFor.current = activeThreadId
    reload()
  }, [data, activeThreadId, reload])

  const merged = useMemo(
    () => (data === undefined ? undefined : withCreatedThreads({ entries: data, created })),
    [data, created],
  )
  if (query.state !== EQueryState.Ready || merged === undefined) return query
  return { ...query, data: merged }
}
