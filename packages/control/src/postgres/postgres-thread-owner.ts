import type { Db, Tx } from '@dltech/atlas-db'

import { UnknownThreadError } from '../errors'

export type ThreadOwner = { userId: string; projectId: string | null; project: string | null }

type OwningSession = { userId: string; projectId: string | null }

const owningSessionOf = async (args: {
  handle: Db | Tx
  threadId: string
}): Promise<OwningSession | null> => {
  const main = await args.handle.orm.v2.V2Session.where({ mainThreadId: args.threadId })
    .select('userId', 'projectId')
    .first()
  if (main !== null) return main
  const thread = await args.handle.orm.v2.V2Thread.where({ id: args.threadId })
    .select('sessionId')
    .first()
  if (thread === null) return null
  return await args.handle.orm.v2.V2Session.where({ id: thread.sessionId })
    .select('userId', 'projectId')
    .first()
}

export const threadOwnerOf = async (args: {
  handle: Db | Tx
  threadId: string
}): Promise<ThreadOwner> => {
  const session = await owningSessionOf(args)
  if (session === null) throw new UnknownThreadError(args.threadId)
  if (session.projectId === null) {
    return { userId: session.userId, projectId: null, project: null }
  }
  const project = await args.handle.orm.public.Project.where({ id: session.projectId })
    .select('repo')
    .first()
  return { userId: session.userId, projectId: session.projectId, project: project?.repo ?? null }
}
