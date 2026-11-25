'use client'

import { useEffect, useMemo } from 'react'

import type { Project } from '@dltech/atlas-wire/web'

import { fetchProjects } from '@/features/projects/data/projects-api'
import { markSidebarReady } from '@/lib/analytics/app-load'
import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { EQueryState, type CloudQuery, useCloudQuery } from '@/lib/use-cloud-query'

import type { ProjectThreads, ShellThreads } from './thread-partition'
import { useV2Sessions } from './use-v2-sessions'
import { withV2Sessions } from './v2-rows'

const entriesOf = (projects: readonly Project[]): ProjectThreads[] => [
  ...projects.map((project) => ({ project, sessions: [] })),
  { project: null, sessions: [] },
]

export function useShellEntries(): CloudQuery<ShellThreads> {
  const sessions = useV2Sessions()
  const projects = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  const entries = useMemo(
    () => withV2Sessions({ entries: entriesOf(projects.data ?? []), sessions }),
    [projects.data, sessions],
  )
  const ready = projects.state === EQueryState.Ready
  useEffect(() => {
    if (ready) markSidebarReady()
  }, [ready])
  if (projects.state === EQueryState.Failed) {
    return {
      state: EQueryState.Failed,
      data: undefined,
      error: projects.error,
      reload: projects.reload,
    }
  }
  if (!ready) {
    return {
      state: EQueryState.Loading,
      data: undefined,
      error: undefined,
      reload: projects.reload,
    }
  }
  return {
    state: EQueryState.Ready,
    data: { entries, counts: null },
    error: undefined,
    reload: projects.reload,
  }
}
