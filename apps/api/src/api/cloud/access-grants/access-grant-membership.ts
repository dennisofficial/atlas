import { ConflictException, NotFoundException } from '@nestjs/common'
import { isUniqueViolation, type Tx } from '@dltech/atlas-db'

import {
  cleanupPersonalGrant,
  cleanupProjectGrant,
  createPersonalGrant,
  createProjectGrant,
} from '../../../_lib/access-grants/grant-of-one'

export { cleanupPersonalGrant, cleanupProjectGrant }

const GRANT_NOT_FOUND = 'access grant not found'
const GRANT_NAME_TAKEN = 'a grant with that name already exists'

export const withGrantNameConflict = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    throw new ConflictException(GRANT_NAME_TAKEN)
  }
}

export const assertPersonalGrant = async (args: {
  tx: Tx
  userId: string
  grantId: string
}): Promise<void> => {
  const row = await args.tx.orm.public.UserAccessGrant.where({
    id: args.grantId,
    userId: args.userId,
  }).first()
  if (row === null) throw new NotFoundException(GRANT_NOT_FOUND)
}

export const assertProjectGrant = async (args: {
  tx: Tx
  projectId: string
  grantId: string
}): Promise<void> => {
  const row = await args.tx.orm.public.ProjectAccessGrant.where({
    id: args.grantId,
    projectId: args.projectId,
  }).first()
  if (row === null) throw new NotFoundException(GRANT_NOT_FOUND)
}

export const resolvePersonalGrantId = async (args: {
  tx: Tx
  userId: string
  requestedGrantId: string | undefined
  existingGrantId: string | null
  label: string
}): Promise<string> => {
  if (args.requestedGrantId !== undefined) {
    await assertPersonalGrant({
      tx: args.tx,
      userId: args.userId,
      grantId: args.requestedGrantId,
    })
    return args.requestedGrantId
  }
  if (args.existingGrantId !== null) return args.existingGrantId
  return createPersonalGrant({ tx: args.tx, userId: args.userId, label: args.label })
}

export const resolveProjectGrantId = async (args: {
  tx: Tx
  projectId: string
  requestedGrantId: string | undefined
  existingGrantId: string | null
  label: string
}): Promise<string> => {
  if (args.requestedGrantId !== undefined) {
    await assertProjectGrant({
      tx: args.tx,
      projectId: args.projectId,
      grantId: args.requestedGrantId,
    })
    return args.requestedGrantId
  }
  if (args.existingGrantId !== null) return args.existingGrantId
  return createProjectGrant({ tx: args.tx, projectId: args.projectId, label: args.label })
}
