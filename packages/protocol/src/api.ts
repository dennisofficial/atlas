import { z } from 'zod'

export const v2SessionCreateInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().optional(),
})

export const v2SessionListInputSchema = z.object({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const v2SessionPostInputSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
})

export const v2SessionEventsInputSchema = z.object({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

export const v2SessionStatusInputSchema = z.object({
  sessionId: z.string().min(1),
})

export type V2SessionCreateInput = z.infer<typeof v2SessionCreateInputSchema>
export type V2SessionListInput = z.infer<typeof v2SessionListInputSchema>
export type V2SessionPostInput = z.infer<typeof v2SessionPostInputSchema>
export type V2SessionEventsInput = z.infer<typeof v2SessionEventsInputSchema>
export type V2SessionStatusInput = z.infer<typeof v2SessionStatusInputSchema>
