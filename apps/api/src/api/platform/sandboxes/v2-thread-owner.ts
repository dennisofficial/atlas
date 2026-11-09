import { db } from '@dltech/atlas-db'
import { NotFoundException } from '@nestjs/common'

export type V2ThreadOwner = { userId: string; project: string | null }

export const v2ThreadOwnerOf = async (threadId: string): Promise<V2ThreadOwner> => {
  const session = await db.orm.v2.V2Session.where({ mainThreadId: threadId })
    .select('userId', 'projectId')
    .first()
  if (session === null) throw new NotFoundException('thread not found')
  const project = await db.orm.public.Project.where({ id: session.projectId })
    .select('repo')
    .first()
  return { userId: session.userId, project: project?.repo ?? null }
}
