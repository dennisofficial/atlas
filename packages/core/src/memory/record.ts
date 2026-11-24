import { z } from 'zod'

import { EMemoryScope, EMemoryType } from './vocabulary'

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
