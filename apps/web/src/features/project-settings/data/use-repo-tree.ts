'use client'

import { useCallback } from 'react'

import { api, cloudCall } from '@/lib/api-client'
import { useCloudQuery } from '@/lib/use-cloud-query'

const fetchRepoTree = async (projectId: string) =>
  (await cloudCall(api.projectResources.repoTree.query({ projectId }))).entries

export function useRepoTreeEntries(projectId: string) {
  const load = useCallback(async () => await fetchRepoTree(projectId), [projectId])
  return useCloudQuery({ key: `repo-tree:${projectId}`, load })
}
