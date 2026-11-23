import type { ApiClient } from '@dltech/atlas-api-router'

import type { IProjectSummary, V2SessionSummary } from './session-groups'
import { listV2Sessions } from './v2-sessions'

export type LoadedSessions = {
  projects: readonly IProjectSummary[]
  sessions: readonly V2SessionSummary[]
}

export const loadSessions = async (args: { api: ApiClient }): Promise<LoadedSessions> => {
  const [projects, sessions] = await Promise.all([
    args.api.projects.list.query(),
    listV2Sessions({ api: args.api }),
  ])
  return {
    projects: projects.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    sessions,
  }
}
