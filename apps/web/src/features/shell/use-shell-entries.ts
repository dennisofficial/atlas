'use client'

import { useEffect, useRef } from 'react'

import { fetchProjects, fetchThreads } from '@/features/threads/data/threads-api'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { hasThread, type ProjectThreads } from './thread-partition'

async function loadShellEntries(): Promise<ProjectThreads[]> {
  const projects = await fetchProjects()
  const lists = await Promise.all(projects.map((project) => fetchThreads(project.id)))
  return projects.map((project, index) => ({
    project,
    threads: lists[index] ?? [],
  }))
}

export function useShellEntries(activeThreadId: string | null): CloudQuery<ProjectThreads[]> {
  const query = useCloudQuery({ key: 'shell-threads', load: loadShellEntries })
  const reloadedFor = useRef<string | null>(null)
  const { data, reload } = query

  useEffect(() => {
    if (data === undefined || activeThreadId === null) return
    if (hasThread({ entries: data, threadId: activeThreadId })) return
    if (reloadedFor.current === activeThreadId) return
    reloadedFor.current = activeThreadId
    reload()
  }, [data, activeThreadId, reload])

  return query
}
