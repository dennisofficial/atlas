import { z } from 'zod'

import { threadIdWireSchema } from './request-wire'
import { saidUploadWireSchema } from './upload-wire'

export const saidImageWireSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export type SaidImageWire = z.infer<typeof saidImageWireSchema>

export const saidFileWireSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  filename: z.string().optional(),
})

export type SaidFileWire = z.infer<typeof saidFileWireSchema>

export const takeBackPendingReplySchema = z.object({
  taken: z
    .object({
      text: z.string(),
      images: z.array(saidImageWireSchema).readonly(),
      files: z.array(saidFileWireSchema).readonly(),
      uploads: z.array(saidUploadWireSchema).readonly().optional(),
      context: z.array(z.unknown()).readonly().optional(),
    })
    .nullable(),
})
export type TakeBackPendingReply = z.infer<typeof takeBackPendingReplySchema>

export const sayToAgentParamsSchema = z.object({
  threadId: threadIdWireSchema,
  agentId: threadIdWireSchema,
  text: z.string(),
  images: z.array(saidImageWireSchema).readonly().optional(),
  files: z.array(saidFileWireSchema).readonly().optional(),
})
export type SayToAgentParams = z.infer<typeof sayToAgentParamsSchema>
