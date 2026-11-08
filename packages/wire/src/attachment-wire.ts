import { z } from 'zod'

import { MAX_UPLOAD_BYTES } from './upload-wire'

export const MAX_ATTACHMENTS = 20
export const MAX_IMAGE_DATA_CHARS = 3_500_000
export const MAX_INLINE_ATTACHMENT_CHARS = 14_000_000

const inlineDataSchema = z.string().max(MAX_IMAGE_DATA_CHARS)

export const attachmentContentWireSchema = z.discriminatedUnion('store', [
  z.object({ store: z.literal('inline'), data: inlineDataSchema }),
  z.object({
    store: z.literal('upload'),
    uploadId: z.uuid(),
    pathname: z.string().max(500),
    inline: inlineDataSchema.optional(),
  }),
  z.object({
    store: z.literal('media'),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    inline: inlineDataSchema.optional(),
  }),
])

export const attachmentWireSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  mediaType: z.string().max(200),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  source: z.string().max(500).optional(),
  content: attachmentContentWireSchema,
  image: z
    .object({
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    })
    .optional(),
})

export type AttachmentWire = z.infer<typeof attachmentWireSchema>

const inlineCharsOf = (attachment: AttachmentWire): number => {
  const { content } = attachment
  const data = content.store === 'inline' ? content.data : content.inline
  return data?.length ?? 0
}

export const attachmentsWireSchema = z
  .array(attachmentWireSchema)
  .max(MAX_ATTACHMENTS)
  .refine(
    (attachments) =>
      attachments.reduce((total, entry) => total + inlineCharsOf(entry), 0) <=
      MAX_INLINE_ATTACHMENT_CHARS,
    'attachments carry too much inline data',
  )
  .readonly()
