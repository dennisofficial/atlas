import { z } from 'zod'

import { threadIdWireSchema } from './request-wire'
import { MAX_UPLOAD_BYTES, saidUploadWireSchema } from './upload-wire'

export const COMPOSER_UPLOADS_PREFIX = 'composer-uploads/'

const pathnameSchema = z.string().min(1).max(500)

export const composerUploadPresignInputSchema = z.strictObject({
  name: z.string().min(1).max(500),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  mediaType: z.string().max(200),
})
export type ComposerUploadPresignInput = z.infer<typeof composerUploadPresignInputSchema>

export const composerUploadPresignReplySchema = z.object({
  upload: saidUploadWireSchema,
  uploadUrl: z.url(),
  validUntil: z.number().int(),
})
export type ComposerUploadPresignReply = z.infer<typeof composerUploadPresignReplySchema>

export const composerUploadDiscardInputSchema = z.strictObject({ pathname: pathnameSchema })
export type ComposerUploadDiscardInput = z.infer<typeof composerUploadDiscardInputSchema>

export const composerUploadDownloadInputSchema = z.strictObject({
  threadId: threadIdWireSchema,
  pathname: pathnameSchema,
})
export type ComposerUploadDownloadInput = z.infer<typeof composerUploadDownloadInputSchema>

export const composerUploadDownloadReplySchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({ found: z.literal(true), downloadUrl: z.url(), size: z.number().int().nonnegative() }),
])
export type ComposerUploadDownloadReply = z.infer<typeof composerUploadDownloadReplySchema>
