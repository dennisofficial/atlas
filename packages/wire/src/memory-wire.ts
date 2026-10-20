import { z } from 'zod'

export enum EMemoryScope {
  Global = 'global',
  Project = 'project',
}

export enum EMemoryType {
  User = 'user',
  Feedback = 'feedback',
  Project = 'project',
  Reference = 'reference',
}

export const MEMORY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
export const MEMORY_PROJECT_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/
export const MAX_MEMORY_DESCRIPTION_CHARS = 300
export const MAX_MEMORY_BODY_CHARS = 20_000

export const MEMORY_STALE_REVISION_CODE = 'memory-stale-revision'
export const MEMORY_EDIT_NO_MATCH_CODE = 'memory-edit-no-match'
export const MEMORY_EDIT_AMBIGUOUS_CODE = 'memory-edit-ambiguous'

export const memorySummarySchema = z.object({
  scope: z.enum(EMemoryScope),
  project: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  type: z.enum(EMemoryType),
  revision: z.number().int(),
  updatedAt: z.string(),
})
export type MemorySummary = z.infer<typeof memorySummarySchema>

export const memoryEntrySchema = memorySummarySchema.extend({ body: z.string() })
export type MemoryEntry = z.infer<typeof memoryEntrySchema>

export const memoryListSchema = z.object({ memories: z.array(memorySummarySchema) })
export type MemoryList = z.infer<typeof memoryListSchema>
