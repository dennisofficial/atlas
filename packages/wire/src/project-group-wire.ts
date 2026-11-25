import { z } from 'zod'

import { EConfigLayer } from '@dltech/atlas-core'

export { EConfigLayer } from '@dltech/atlas-core'

export const configLayerSchema = z.enum(EConfigLayer)

export const configLayerOwnerSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
})
export type ConfigLayerOwner = z.infer<typeof configLayerOwnerSchema>

export const PROJECT_GROUP_NAME_MAX = 80

export const projectGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectIds: z.array(z.string().min(1)),
})
export type ProjectGroup = z.infer<typeof projectGroupSchema>

export const projectGroupListSchema = z.object({ groups: z.array(projectGroupSchema) })
export type ProjectGroupList = z.infer<typeof projectGroupListSchema>

export const projectGroupSaveSchema = z.strictObject({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(PROJECT_GROUP_NAME_MAX),
})
export type ProjectGroupSave = z.infer<typeof projectGroupSaveSchema>

export const projectGroupKeySchema = z.strictObject({ id: z.string().min(1) })
export type ProjectGroupKey = z.infer<typeof projectGroupKeySchema>

export const projectGroupAssignSchema = z.strictObject({
  projectId: z.string().min(1),
  groupId: z.string().min(1).nullable(),
})
export type ProjectGroupAssign = z.infer<typeof projectGroupAssignSchema>
