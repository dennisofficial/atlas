import type { ProjectGroup } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export const GROUPS_KEY = 'project-groups'

export const fetchGroups = async (): Promise<ProjectGroup[]> =>
  (await cloudCall(api.projectGroups.list.query())).groups

export const saveProjectGroup = (args: { id?: string; name: string }): Promise<ProjectGroup> =>
  cloudCall(
    api.projectGroups.save.mutate(
      args.id === undefined ? { name: args.name } : { id: args.id, name: args.name },
    ),
  )

export const removeProjectGroup = (id: string): Promise<void> =>
  cloudCall(api.projectGroups.remove.mutate({ id }))

export const assignProjectGroup = (args: {
  projectId: string
  groupId: string | null
}): Promise<void> => cloudCall(api.projectGroups.assign.mutate(args))
