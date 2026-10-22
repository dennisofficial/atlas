import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'

export const THREAD_PROJECT_NOT_FOUND = 'project not found'

export const projectReachableBy = async (args: { userId: string; projectId: string }): Promise<boolean> => {
  const project = await db.orm.public.Project.where({ id: args.projectId })
    .select('ownerUserId', 'organizationId')
    .first()
  if (project === null) return false
  if (project.ownerUserId === args.userId) return true
  if (project.organizationId === null) return false
  const member = await db.orm.public.Member.where({
    organizationId: project.organizationId,
    userId: args.userId,
  })
    .select('id')
    .first()
  return member !== null
}

export const threadProjectColumn = async (args: {
  userId: string
  projectId: string | undefined
}): Promise<{ projectId?: string }> => {
  if (args.projectId === undefined) return {}
  if (!(await projectReachableBy({ userId: args.userId, projectId: args.projectId }))) {
    throw new NotFoundException(THREAD_PROJECT_NOT_FOUND)
  }
  return { projectId: args.projectId }
}
