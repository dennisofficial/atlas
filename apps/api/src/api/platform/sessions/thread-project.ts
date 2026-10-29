import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'

export const THREAD_PROJECT_NOT_FOUND = 'project not found'

export const projectReachableBy = async (args: {
  userId: string
  projectId: string
}): Promise<boolean> => {
  const project = await db.orm.public.Project.where({ id: args.projectId })
    .select('ownerUserId')
    .first()
  return project !== null && project.ownerUserId === args.userId
}

export type ThreadProjectColumns = { projectId?: string }

export const threadProjectColumn = async (args: {
  userId: string
  projectId: string | undefined
}): Promise<ThreadProjectColumns> => {
  if (args.projectId === undefined) return {}
  if (!(await projectReachableBy({ userId: args.userId, projectId: args.projectId }))) {
    throw new NotFoundException(THREAD_PROJECT_NOT_FOUND)
  }
  return { projectId: args.projectId }
}
