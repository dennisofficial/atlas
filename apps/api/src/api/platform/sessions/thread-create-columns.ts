import { nextThreadId } from './append'
import type { ThreadDraft } from './sessions.types'
import type { ThreadProjectColumns } from './thread-project'

export const createColumnsOf = (args: {
  userId: string
  draft: ThreadDraft
  project: ThreadProjectColumns
}) => {
  const { draft } = args
  return {
    id: draft.id ?? nextThreadId(),
    userId: args.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(draft.title === undefined ? {} : { title: draft.title }),
    ...(draft.workspace === undefined ? {} : { workspace: draft.workspace }),
    ...(draft.repo === undefined ? {} : { repo: draft.repo }),
    ...(draft.model === undefined ? {} : { modelRef: draft.model }),
    ...(draft.effort === undefined ? {} : { modelEffort: draft.effort }),
    ...args.project,
    ...(draft.agent === undefined
      ? {}
      : { spawnerThreadId: draft.agent.spawnedBy, agentType: draft.agent.type }),
  }
}
