import type { ApiClient } from '@dltech/atlas-api-router'
import type { WireThread } from '@dltech/atlas-wire/web'

import type { IProjectSummary, V2SessionSummary } from './session-groups'
import { listV2Sessions } from './v2-sessions'

export type LoadedSessions = {
  projects: readonly IProjectSummary[]
  threads: readonly WireThread[]
  sessions: readonly V2SessionSummary[]
}

export const loadSessions = async (args: { api: ApiClient }): Promise<LoadedSessions> => {
  const projects = await args.api.projects.list.query()
  const [lists, sessions] = await Promise.all([
    Promise.all(
      projects.map((project) => args.api.threads.list.query({ projectId: project.id, limit: 50 })),
    ),
    listV2Sessions({ api: args.api }),
  ])
  return {
    projects: projects.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    threads: lists.flat(),
    sessions,
  }
}
