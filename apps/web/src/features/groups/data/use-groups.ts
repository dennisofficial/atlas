'use client'

import { useCallback, useMemo } from 'react'

import type { ProjectGroup } from '@dltech/atlas-wire/web'

import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'

import {
  GROUPS_KEY,
  assignProjectGroup,
  fetchGroups,
  removeProjectGroup,
  saveProjectGroup,
} from './groups-api'

export type GroupsResource = {
  query: CloudQuery<ProjectGroup[]>
  save: (args: { id?: string; name: string }) => Promise<void>
  remove: (id: string) => Promise<void>
  assign: (args: { projectId: string; groupId: string | null }) => Promise<void>
}

export function useGroups(): GroupsResource {
  const query = useCloudQuery({ key: GROUPS_KEY, load: fetchGroups })
  const { reload } = query
  const invalidate = useInvalidateCloud()

  const refresh = useCallback(async () => {
    reload()
    await invalidate([PROJECTS_KEY, GROUPS_KEY])
  }, [reload, invalidate])

  const save = useCallback(
    async (args: { id?: string; name: string }) => {
      await saveProjectGroup(args)
      await refresh()
    },
    [refresh],
  )
  const remove = useCallback(
    async (id: string) => {
      await removeProjectGroup(id)
      await refresh()
    },
    [refresh],
  )
  const assign = useCallback(
    async (args: { projectId: string; groupId: string | null }) => {
      await assignProjectGroup(args)
      await refresh()
    },
    [refresh],
  )
  return useMemo(() => ({ query, save, remove, assign }), [query, save, remove, assign])
}
