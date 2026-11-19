import { EStreamSurface } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const sessionStreamFollowInputSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    surface: z.enum(EStreamSurface).optional(),
    afterSeq: z.number().int().min(0).optional(),
    afterHash: z.string().min(1).optional(),
  })
  .refine((input) => input.afterHash === undefined || input.afterSeq !== undefined, {
    message: 'afterHash requires afterSeq',
    path: ['afterHash'],
  })

export type SessionStreamFollowInput = z.infer<typeof sessionStreamFollowInputSchema>
