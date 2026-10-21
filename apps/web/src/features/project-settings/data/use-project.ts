'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { fetchProject, saveProject, type ProjectView, type SaveProjectBody } from './project-api'

export type ProjectResource = {
  query: CloudQuery<ProjectView>
  save: (body: SaveProjectBody) => Promise<void>
}

export function useProject(projectId: string): ProjectResource {
  const load = useCallback(() => fetchProject(projectId), [projectId])
  const query = useCloudQuery({ key: `project:${projectId}`, load })
  const { reload } = query
  const save = useCallback(
    async (body: SaveProjectBody) => {
      await saveProject({ projectId, body })
      reload()
    },
    [projectId, reload],
  )
  return { query, save }
}
