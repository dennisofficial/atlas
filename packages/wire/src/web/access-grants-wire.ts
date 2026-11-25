import { z } from 'zod'

import { configLayerOwnerSchema, configLayerSchema } from '../project-group-wire'
import { fileMountModeSchema } from './file-mounts-wire'

export enum EAccessScope {
  Personal = 'personal',
  Group = 'group',
  Project = 'project',
}

export enum EAccessMemberKind {
  Secret = 'secret',
  File = 'file',
}

export const ACCESS_GRANT_NAME_MAX = 80
export const ACCESS_GRANT_INSTRUCTION_MAX = 2000

export const accessScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal(EAccessScope.Personal) }),
  z.strictObject({ kind: z.literal(EAccessScope.Group), groupId: z.string().min(1) }),
  z.strictObject({ kind: z.literal(EAccessScope.Project), projectId: z.string().min(1) }),
])
export type AccessScope = z.infer<typeof accessScopeSchema>

export const accessGrantSecretSchema = z.object({
  name: z.string(),
  updatedAt: z.string(),
})
export type AccessGrantSecret = z.infer<typeof accessGrantSecretSchema>

export const accessGrantFileSchema = z.object({
  path: z.string(),
  mode: fileMountModeSchema,
  updatedAt: z.string(),
})
export type AccessGrantFile = z.infer<typeof accessGrantFileSchema>

export const accessGrantSchema = z.object({
  id: z.string(),
  name: z.string(),
  instruction: z.string(),
  secrets: z.array(accessGrantSecretSchema),
  files: z.array(accessGrantFileSchema),
  updatedAt: z.string(),
})
export type AccessGrant = z.infer<typeof accessGrantSchema>

export const accessGrantListInputSchema = z.strictObject({ scope: accessScopeSchema })
export type AccessGrantListInput = z.infer<typeof accessGrantListInputSchema>

export const accessGrantListSchema = z.object({ grants: z.array(accessGrantSchema) })
export type AccessGrantList = z.infer<typeof accessGrantListSchema>

export const accessGrantSaveSchema = z.strictObject({
  scope: accessScopeSchema,
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(ACCESS_GRANT_NAME_MAX),
  instruction: z.string().max(ACCESS_GRANT_INSTRUCTION_MAX),
})
export type AccessGrantSave = z.infer<typeof accessGrantSaveSchema>

export const accessGrantSavedSchema = z.object({ id: z.string() })
export type AccessGrantSaved = z.infer<typeof accessGrantSavedSchema>

export const accessGrantKeySchema = z.strictObject({
  scope: accessScopeSchema,
  id: z.string().min(1),
})
export type AccessGrantKey = z.infer<typeof accessGrantKeySchema>

export const accessGrantMemberSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal(EAccessMemberKind.Secret), name: z.string().min(1) }),
  z.strictObject({ kind: z.literal(EAccessMemberKind.File), path: z.string().min(1) }),
])
export type AccessGrantMember = z.infer<typeof accessGrantMemberSchema>

export const accessGrantMoveSchema = z.strictObject({
  scope: accessScopeSchema,
  grantId: z.string().min(1),
  member: accessGrantMemberSchema,
})
export type AccessGrantMove = z.infer<typeof accessGrantMoveSchema>

export const accessGrantLayeredSecretSchema = accessGrantSecretSchema.extend({
  overriddenBy: configLayerSchema.nullable(),
})
export type AccessGrantLayeredSecret = z.infer<typeof accessGrantLayeredSecretSchema>

export const accessGrantLayeredFileSchema = accessGrantFileSchema.extend({
  overriddenBy: configLayerSchema.nullable(),
})
export type AccessGrantLayeredFile = z.infer<typeof accessGrantLayeredFileSchema>

export const accessGrantLayeredGrantSchema = accessGrantSchema.extend({
  secrets: z.array(accessGrantLayeredSecretSchema),
  files: z.array(accessGrantLayeredFileSchema),
})
export type AccessGrantLayeredGrant = z.infer<typeof accessGrantLayeredGrantSchema>

export const accessGrantLayerSchema = z.object({
  layer: configLayerSchema,
  owner: configLayerOwnerSchema,
  grants: z.array(accessGrantLayeredGrantSchema),
})
export type AccessGrantLayer = z.infer<typeof accessGrantLayerSchema>

export const accessGrantLayeredListSchema = z.object({ layers: z.array(accessGrantLayerSchema) })
export type AccessGrantLayeredList = z.infer<typeof accessGrantLayeredListSchema>

export const accessGrantLayeredInputSchema = z.strictObject({ scope: accessScopeSchema })
export type AccessGrantLayeredInput = z.infer<typeof accessGrantLayeredInputSchema>
