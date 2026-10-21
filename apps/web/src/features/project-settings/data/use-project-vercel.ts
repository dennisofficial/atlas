'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { fetchVercelProjectId, saveVercelProjectId } from './project-settings-api'

export type ProjectVercel = {
  query: CloudQuery<string>
  save: (value: string) => Promise<void>
}

export function useProjectVercel(projectId: string): ProjectVercel {
  const load = useCallback(() => fetchVercelProjectId(projectId), [projectId])
  const query = useCloudQuery({ key: `vercel:${projectId}`, load })
  const { reload } = query
  const save = useCallback(
    async (value: string) => {
      await saveVercelProjectId({ projectId, value })
      reload()
    },
    [projectId, reload],
  )
  return { query, save }
}
