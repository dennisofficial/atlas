'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import {
  deleteFileMount,
  fetchRepoTree,
  listFileMounts,
  putFileMount,
  type ListedFileMount,
} from './file-mounts-api'

export type FileMountsSnapshot = { mounts: ListedFileMount[]; fetchedAt: number }

export type FileMountsResource = {
  query: CloudQuery<FileMountsSnapshot>
  save: (args: { path: string; contents: string; mode: number }) => Promise<void>
  remove: (path: string) => Promise<void>
}

export function useProjectFileMounts(projectId: string): FileMountsResource {
  const load = useCallback(
    async (): Promise<FileMountsSnapshot> => ({
      mounts: await listFileMounts(projectId),
      fetchedAt: Date.now(),
    }),
    [projectId],
  )
  const query = useCloudQuery({ key: `file-mounts:${projectId}`, load })
  const { reload } = query
  const save = useCallback(
    async (args: { path: string; contents: string; mode: number }) => {
      await putFileMount({ projectId, ...args })
      reload()
    },
    [projectId, reload],
  )
  const remove = useCallback(
    async (path: string) => {
      await deleteFileMount({ projectId, path })
      reload()
    },
    [projectId, reload],
  )
  return { query, save, remove }
}

export function useRepoTreeEntries(projectId: string) {
  const load = useCallback(async () => (await fetchRepoTree(projectId)).entries, [projectId])
  return useCloudQuery({ key: `repo-tree:${projectId}`, load })
}
