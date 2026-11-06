import {
  MAX_INLINE_BYTES,
  MAX_MESSAGE_UPLOADS,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  mediaRefSchema,
} from '@dltech/atlas-core'
import { z } from 'zod'

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)

export const sessionPostMediaSchema = z.strictObject({
  hash: hashSchema,
  source: z.string().min(1).max(200).optional(),
})

export const sessionPostMediaListSchema = z.array(sessionPostMediaSchema).max(MAX_MESSAGE_UPLOADS)

export const inboxMediaSchema = z.object({
  media: mediaRefSchema,
  source: z.string().optional(),
})

export const mediaPresignInputSchema = z.strictObject({
  hash: hashSchema,
  size: z.number().int().positive().max(MAX_INLINE_BYTES),
  mediaType: z.enum(SUPPORTED_IMAGE_MEDIA_TYPES),
})

export const mediaPresignOutputSchema = z.discriminatedUnion('exists', [
  z.strictObject({ exists: z.literal(true), media: mediaRefSchema }),
  z.strictObject({
    exists: z.literal(false),
    uploadUrl: z.url(),
    validUntil: z.number(),
  }),
])

export const mediaConfirmInputSchema = z.strictObject({ hash: hashSchema })

export const mediaConfirmOutputSchema = z.strictObject({
  media: mediaRefSchema,
})

export const mediaUrlInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  hash: hashSchema,
})

export const mediaUrlOutputSchema = z.strictObject({ url: z.url() })

export type SessionPostMedia = z.infer<typeof sessionPostMediaSchema>
export type InboxMedia = z.infer<typeof inboxMediaSchema>
export type MediaPresignInput = z.infer<typeof mediaPresignInputSchema>
export type MediaPresignOutput = z.infer<typeof mediaPresignOutputSchema>
export type MediaConfirmInput = z.infer<typeof mediaConfirmInputSchema>
export type MediaConfirmOutput = z.infer<typeof mediaConfirmOutputSchema>
export type MediaUrlInput = z.infer<typeof mediaUrlInputSchema>
export type MediaUrlOutput = z.infer<typeof mediaUrlOutputSchema>
