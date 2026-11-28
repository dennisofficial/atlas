import { EStreamCacheOutcome, EStreamSurface } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const sessionStreamFollowInputSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    surface: z.enum(EStreamSurface).optional(),
    cache: z.enum(EStreamCacheOutcome).optional(),
    hydrateMs: z.number().int().min(0).optional(),
    afterSeq: z.number().int().min(0).optional(),
    afterHash: z.string().min(1).optional(),
    tailViewVersion: z.number().int().min(1).optional(),
  })
  .refine((input) => input.afterHash === undefined || input.afterSeq !== undefined, {
    message: 'afterHash requires afterSeq',
    path: ['afterHash'],
  })

export type SessionStreamFollowInput = z.infer<typeof sessionStreamFollowInputSchema>
