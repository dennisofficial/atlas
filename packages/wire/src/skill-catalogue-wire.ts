import { z } from 'zod'

import { commandSkillWireSchema } from './request-wire'

export enum ESkillCatalogueOrigin {
  BuiltIn = 'builtin',
  User = 'user',
  Project = 'project',
}

export const skillCatalogueRequestSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
})
export type SkillCatalogueRequest = z.infer<typeof skillCatalogueRequestSchema>

export const skillCatalogueEntrySchema = commandSkillWireSchema.extend({
  origin: z.enum(ESkillCatalogueOrigin).optional(),
})
export type SkillCatalogueEntry = z.infer<typeof skillCatalogueEntrySchema>

export const skillCatalogueReplySchema = z.object({ skills: z.array(skillCatalogueEntrySchema) })
export type SkillCatalogueReply = z.infer<typeof skillCatalogueReplySchema>
