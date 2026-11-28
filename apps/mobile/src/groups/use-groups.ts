import type { ApiClient } from '@dltech/atlas-api-router'
import type { Project, ProjectGroup } from '@dltech/atlas-wire/web'

import { EResourceState } from '../settings/api-resource-state'
import { useApiResource } from '../settings/use-api-resource'

export type IGroupsData = { groups: ProjectGroup[]; projects: Project[] }

export const useGroupsData = ({
  api,
}: {
  api: ApiClient | undefined
}): {
  state: EResourceState
  data: IGroupsData | null
  reload: () => void
} =>
  useApiResource({
    load: () =>
      api === undefined
        ? Promise.resolve<IGroupsData>({ groups: [], projects: [] })
        : Promise.all([api.projectGroups.list.query(), api.projects.list.query()]).then(
            ([{ groups }, projects]) => ({ groups, projects }),
          ),
    deps: [api],
  })

export const saveGroup = async ({
  api,
  groupId,
  name,
}: {
  api: ApiClient
  groupId?: string
  name: string
}): Promise<void> => {
  await api.projectGroups.save.mutate(groupId === undefined ? { name } : { id: groupId, name })
}

export const removeGroup = async ({
  api,
  groupId,
}: {
  api: ApiClient
  groupId: string
}): Promise<void> => {
  await api.projectGroups.remove.mutate({ id: groupId })
}

export const assignProjectGroup = async ({
  api,
  projectId,
  groupId,
}: {
  api: ApiClient
  projectId: string
  groupId: string | null
}): Promise<void> => {
  await api.projectGroups.assign.mutate({ projectId, groupId })
}
