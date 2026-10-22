import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'

export const THREAD_PROJECT_NOT_FOUND = 'project not found'

type ReachableProject = { id: string; organizationId: string | null }

const reachableProject = async (args: {
  userId: string
  projectId: string
}): Promise<ReachableProject | null> => {
  const project = await db.orm.public.Project.where({ id: args.projectId })
    .select('id', 'ownerUserId', 'organizationId')
    .first()
  if (project === null) return null
  const reached = { id: project.id, organizationId: project.organizationId }
  if (project.ownerUserId === args.userId) return reached
  if (project.organizationId === null) return null
  const member = await db.orm.public.Member.where({
    organizationId: project.organizationId,
    userId: args.userId,
  })
    .select('id')
    .first()
  return member === null ? null : reached
}

export const projectReachableBy = async (args: {
  userId: string
  projectId: string
}): Promise<boolean> => (await reachableProject(args)) !== null

export type ThreadProjectColumns = { projectId?: string; organizationId?: string }

export const threadProjectColumn = async (args: {
  userId: string
  projectId: string | undefined
}): Promise<ThreadProjectColumns> => {
  if (args.projectId === undefined) return {}
  const project = await reachableProject({ userId: args.userId, projectId: args.projectId })
  if (project === null) throw new NotFoundException(THREAD_PROJECT_NOT_FOUND)
  return {
    projectId: project.id,
    ...(project.organizationId === null ? {} : { organizationId: project.organizationId }),
  }
}
