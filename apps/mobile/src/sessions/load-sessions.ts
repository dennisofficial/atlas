import type { ApiClient } from '@dltech/atlas-api-router'
import type { SessionSummary } from '@dltech/atlas-protocol'

import type { IProjectSummary } from './session-groups'
import { listSessions } from './list-sessions'

export type LoadedSessions = {
  projects: readonly IProjectSummary[]
  sessions: readonly SessionSummary[]
}

export const loadSessions = async (args: { api: ApiClient }): Promise<LoadedSessions> => {
  const [projects, sessions] = await Promise.all([
    args.api.projects.list.query(),
    listSessions({ api: args.api }),
  ])
  return {
    projects: projects.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    sessions,
  }
}
