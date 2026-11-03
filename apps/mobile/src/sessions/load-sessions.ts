import type { ApiClient } from '@dltech/atlas-api-router'

import { type ISessionPartition, partitionSessions } from './session-groups'

export const loadSessions = async ({
  api,
  now,
}: {
  api: ApiClient
  now: number
}): Promise<ISessionPartition> => {
  const projects = await api.projects.list.query()
  const lists = await Promise.all(
    projects.map((project) => api.threads.list.query({ projectId: project.id, limit: 50 })),
  )
  return partitionSessions({
    projects: projects.map(({ id, name }) => ({ id, name })),
    threads: lists.flat(),
    now,
  })
}
