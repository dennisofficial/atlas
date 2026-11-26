'use client'

import { useMemo } from 'react'

import { useGroups } from '@/features/groups/data/use-groups'
import { fetchProjects } from '@/features/projects/data/projects-api'
import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import type { GrantMoveScopeOption } from './access-grant-helpers'

export function useGrantMoveTargets(): {
  groups: GrantMoveScopeOption[]
  projects: GrantMoveScopeOption[]
} {
  const groups = useGroups()
  const projects = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  const groupList = groups.query.state === EQueryState.Ready ? groups.query.data : []
  const projectList = projects.state === EQueryState.Ready ? projects.data : []
  return useMemo(
    () => ({
      groups: groupList.map((group) => ({ id: group.id, name: group.name })),
      projects: projectList.map((project) => ({ id: project.id, name: project.name })),
    }),
    [groupList, projectList],
  )
}
