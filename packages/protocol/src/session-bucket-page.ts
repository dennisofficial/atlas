import { z } from 'zod'

import { sessionSummarySchema } from './api'

export enum ESessionPageBucket {
  Inactive = 'inactive',
  Archived = 'archived',
}

export const SESSION_INACTIVE_AFTER_MS = 72 * 60 * 60 * 1000

export const sessionBucketPageInputSchema = z.strictObject({
  bucket: z.enum(ESessionPageBucket),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
})

export type SessionBucketPageInput = z.infer<typeof sessionBucketPageInputSchema>

export const sessionBucketPageCountsSchema = z.strictObject({
  inactive: z.number().int().min(0),
  archived: z.number().int().min(0),
})

export type SessionBucketPageCounts = z.infer<typeof sessionBucketPageCountsSchema>

export const sessionBucketPageOutputSchema = z.strictObject({
  sessions: z.array(sessionSummarySchema),
  counts: sessionBucketPageCountsSchema,
  next: z.string().min(1).optional(),
})

export type SessionBucketPageOutput = z.infer<typeof sessionBucketPageOutputSchema>
