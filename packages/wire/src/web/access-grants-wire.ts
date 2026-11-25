import { z } from 'zod'

export enum EAccessScope {
  Personal = 'personal',
  Project = 'project',
}

export const ACCESS_GRANT_NAME_MAX = 80
export const ACCESS_GRANT_INSTRUCTION_MAX = 2000
export const ACCESS_GRANT_MEMBERS_MAX = 200

export const accessScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal(EAccessScope.Personal) }),
  z.strictObject({ kind: z.literal(EAccessScope.Project), projectId: z.string().min(1) }),
])
export type AccessScope = z.infer<typeof accessScopeSchema>

export const accessGrantSchema = z.object({
  id: z.string(),
  name: z.string(),
  instruction: z.string(),
  secretNames: z.array(z.string()),
  filePaths: z.array(z.string()),
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
  secretNames: z.array(z.string().min(1)).max(ACCESS_GRANT_MEMBERS_MAX),
  filePaths: z.array(z.string().min(1)).max(ACCESS_GRANT_MEMBERS_MAX),
})
export type AccessGrantSave = z.infer<typeof accessGrantSaveSchema>

export const accessGrantSavedSchema = z.object({ id: z.string() })
export type AccessGrantSaved = z.infer<typeof accessGrantSavedSchema>

export const accessGrantKeySchema = z.strictObject({
  scope: accessScopeSchema,
  id: z.string().min(1),
})
export type AccessGrantKey = z.infer<typeof accessGrantKeySchema>
