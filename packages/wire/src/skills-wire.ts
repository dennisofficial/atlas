import { z } from 'zod'

export enum ESkillScope {
  Personal = 'personal',
  Project = 'project',
}

export const skillScopeSchema = z.enum(ESkillScope)

export const skillScopeInputSchema = z.strictObject({
  scope: skillScopeSchema,
  projectId: z.string().min(1).optional(),
})
export type SkillScopeInput = z.infer<typeof skillScopeInputSchema>

export const skillUsageSchema = z.object({
  usedCount30d: z.number().int().min(0),
  lastUsedAt: z.string().nullable(),
})
export type SkillUsage = z.infer<typeof skillUsageSchema>

export const skillSummarySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  fileCount: z.number().int().min(0),
  sizeBytes: z.number().int().min(0),
  updatedAt: z.string(),
  usage: skillUsageSchema,
})
export type SkillSummary = z.infer<typeof skillSummarySchema>

export const skillFileMetaSchema = z.object({
  path: z.string().min(1),
  revision: z.number().int().min(0),
  contentHash: z.string(),
  sizeBytes: z.number().int().min(0),
  isText: z.boolean(),
  updatedAt: z.string(),
})
export type SkillFileMeta = z.infer<typeof skillFileMetaSchema>

export const skillFileContentSchema = skillFileMetaSchema.extend({ content: z.string() })
export type SkillFileContent = z.infer<typeof skillFileContentSchema>

export const SKILL_TEXT_EXTENSIONS = [
  'md',
  'txt',
  'json',
  'yaml',
  'yml',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'toml',
  'sh',
  'py',
  'rb',
  'go',
  'rs',
  'css',
  'html',
  'xml',
  'svg',
] as const

const skillFieldSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/)

export const skillListRequestSchema = skillScopeInputSchema

export const skillListReplySchema = z.object({ skills: z.array(skillSummarySchema) })

export const skillListFilesRequestSchema = skillScopeInputSchema.extend({
  skill: skillFieldSchema,
})

export const skillListFilesReplySchema = z.object({ files: z.array(skillFileMetaSchema) })

export const skillGetRequestSchema = skillScopeInputSchema.extend({
  skill: skillFieldSchema,
  path: z.string().min(1),
})

export const skillPutRequestSchema = z.strictObject({
  scope: skillScopeSchema,
  projectId: z.string().min(1).optional(),
  skill: skillFieldSchema,
  path: z.string().min(1),
  content: z.string(),
  contentHash: z.string(),
  baseRevision: z.number().int().min(0).optional(),
})
export type SkillPutRequest = z.infer<typeof skillPutRequestSchema>

export const skillRevisionReplySchema = z.object({ revision: z.number().int().min(0) })

export const skillRemoveRequestSchema = skillScopeInputSchema.extend({
  skill: skillFieldSchema,
  path: z.string().min(1),
  baseRevision: z.number().int().min(0),
})

export const skillRemovedReplySchema = z.object({ removed: z.literal(true) })

export const skillRemoveSkillRequestSchema = skillScopeInputSchema.extend({
  skill: skillFieldSchema,
})

export const skillRemoveSkillReplySchema = z.object({ removed: z.number().int().min(0) })
