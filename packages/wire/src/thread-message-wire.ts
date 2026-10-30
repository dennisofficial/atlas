import { z } from 'zod'

import { saidImageWireSchema } from './channel-wire'
import { MAX_MESSAGE_UPLOADS, saidUploadWireSchema } from './upload-wire'

export enum EThreadMessageState {
  Delivered = 'delivered',
  Queued = 'queued',
}

export const MAX_MESSAGE_IMAGES = 10

export const threadMessageRequestSchema = z.object({
  sendId: z.string().min(1).max(200),
  text: z.string().min(1).max(100_000),
  images: z.array(saidImageWireSchema).max(MAX_MESSAGE_IMAGES).optional(),
  uploads: z.array(saidUploadWireSchema).max(MAX_MESSAGE_UPLOADS).optional(),
})
export type ThreadMessageRequest = z.infer<typeof threadMessageRequestSchema>

export const threadMessageReplySchema = z.object({
  state: z.enum(EThreadMessageState),
  error: z.string().optional(),
})
export type ThreadMessageReply = z.infer<typeof threadMessageReplySchema>
