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

const memoryProjectSchema = z
  .string()
  .transform((project) => project.toLowerCase())
  .pipe(z.string().regex(MEMORY_PROJECT_PATTERN))

export const memoryProjectQuerySchema = z.strictObject({ project: memoryProjectSchema.optional() })
export type MemoryProjectQueryWire = z.output<typeof memoryProjectQuerySchema>

export const memoryKeySchema = memoryProjectQuerySchema.extend({
  scope: z.enum(EMemoryScope),
  name: z.string().regex(MEMORY_NAME_PATTERN),
})
export type MemoryKeyWire = z.output<typeof memoryKeySchema>

export const memoryPutSchema = memoryKeySchema.extend({
  description: z.string().min(1).max(MAX_MEMORY_DESCRIPTION_CHARS),
  type: z.enum(EMemoryType),
  body: z.string().max(MAX_MEMORY_BODY_CHARS),
})
export type MemoryPutWire = z.output<typeof memoryPutSchema>

export const memoryEditSchema = memoryKeySchema.extend({
  old: z.string().min(1).max(MAX_MEMORY_BODY_CHARS),
  new: z.string().max(MAX_MEMORY_BODY_CHARS),
  revision: z.number().int().min(1),
})
export type MemoryEditWire = z.output<typeof memoryEditSchema>

export const memoryHostThreadSchema = z.strictObject({ threadId: z.string().min(1) })
export type MemoryHostThreadWire = z.output<typeof memoryHostThreadSchema>

export const memoryHostAddressSchema = memoryHostThreadSchema.extend({
  scope: z.enum(EMemoryScope),
  name: z.string().regex(MEMORY_NAME_PATTERN),
})
export type MemoryHostAddressWire = z.output<typeof memoryHostAddressSchema>

export const memoryHostWriteSchema = memoryHostAddressSchema.extend({
  description: z.string().min(1).max(MAX_MEMORY_DESCRIPTION_CHARS),
  type: z.enum(EMemoryType),
  body: z.string().min(1).max(MAX_MEMORY_BODY_CHARS),
})
export type MemoryHostWriteWire = z.output<typeof memoryHostWriteSchema>

export const memoryHostEditSchema = memoryHostAddressSchema.extend({
  old: z.string().min(1).max(MAX_MEMORY_BODY_CHARS),
  new: z.string().max(MAX_MEMORY_BODY_CHARS),
  revision: z.number().int().min(1),
})
export type MemoryHostEditWire = z.output<typeof memoryHostEditSchema>

export const memoryHostListSchema = memoryListSchema.extend({ project: z.string().nullable() })
export type MemoryHostListWire = z.output<typeof memoryHostListSchema>

export const memoryHostEntrySchema = z.object({ memory: memoryEntrySchema.nullable() })
export type MemoryHostEntryWire = z.output<typeof memoryHostEntrySchema>

export const memoryHostSummarySchema = z.object({ memory: memorySummarySchema })
export type MemoryHostSummaryWire = z.output<typeof memoryHostSummarySchema>

export const memoryHostRemovedSchema = z.object({ removed: z.boolean() })
export type MemoryHostRemovedWire = z.output<typeof memoryHostRemovedSchema>
