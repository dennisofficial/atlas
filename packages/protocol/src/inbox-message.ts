import {
  attachmentSchema,
  EMessageOrigin,
  saidUploadSchema,
  SPAWN_FILES_MAX_COUNT,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { inboxMediaSchema } from './media'

export const inboxFileSchema = z.strictObject({
  path: z.string().min(1).max(200),
  text: z.string(),
})

export const inboxMessageSchema = z.strictObject({
  text: z.string(),
  clientId: z.string().min(1).max(200).optional(),
  via: z.nativeEnum(EMessageOrigin).optional(),
  media: z.array(inboxMediaSchema).optional(),
  uploads: z.array(saidUploadSchema).optional(),
  attachments: z.array(attachmentSchema).optional(),
  files: z.array(inboxFileSchema).max(SPAWN_FILES_MAX_COUNT).optional(),
})

export type InboxFile = z.infer<typeof inboxFileSchema>
export type InboxMessage = z.infer<typeof inboxMessageSchema>
