import { z } from 'zod'

import { EAttachmentStore, type Attachment } from './attachment'

const contentSchema = z.discriminatedUnion('store', [
  z.object({ store: z.literal(EAttachmentStore.Inline), data: z.string() }),
  z.object({
    store: z.literal(EAttachmentStore.Upload),
    uploadId: z.string().min(1),
    pathname: z.string(),
    inline: z.string().optional(),
  }),
  z.object({
    store: z.literal(EAttachmentStore.Media),
    hash: z.string().min(1),
    inline: z.string().optional(),
  }),
])

export const attachmentSchema: z.ZodType<Attachment> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mediaType: z.string(),
  size: z.number().int().nonnegative(),
  source: z.string().optional(),
  content: contentSchema,
  image: z
    .object({
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    })
    .optional(),
})
