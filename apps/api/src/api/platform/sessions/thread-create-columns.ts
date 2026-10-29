import { nextSessionId, nextThreadId } from './append'
import type { SessionDraft } from './create-session'
import type { ThreadDraft } from './sessions.types'
import type { ThreadProjectColumns } from './thread-project'

export const createColumnsOf = (args: {
  userId: string
  draft: ThreadDraft
  project: ThreadProjectColumns
}) => {
  const { draft } = args
  const at = new Date()
  const thread = {
    id: draft.id ?? nextThreadId(),
    userId: args.userId,
    createdAt: at,
    updatedAt: at,
    ...(draft.model === undefined ? {} : { modelRef: draft.model }),
    ...(draft.effort === undefined ? {} : { modelEffort: draft.effort }),
  }
  const session: SessionDraft = {
    id: nextSessionId(),
    userId: args.userId,
    createdAt: at,
    updatedAt: at,
    title: draft.title,
    workspace: draft.workspace,
    repo: draft.repo,
    projectId: args.project.projectId,
  }
  return { thread, session, agent: draft.agent }
}
