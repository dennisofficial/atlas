import type { Db, Tx } from '@dltech/atlas-db'

import { UnknownThreadError } from '../errors'

export type ThreadOwner = { userId: string; project: string | null }

export const threadOwnerOf = async (args: {
  handle: Db | Tx
  threadId: string
}): Promise<ThreadOwner> => {
  const session = await args.handle.orm.v2.V2Session.where({
    mainThreadId: args.threadId,
  })
    .select('userId', 'projectId')
    .first()
  if (session === null) throw new UnknownThreadError(args.threadId)
  const project = await args.handle.orm.public.Project.where({ id: session.projectId })
    .select('repo')
    .first()
  return { userId: session.userId, project: project?.repo ?? null }
}
