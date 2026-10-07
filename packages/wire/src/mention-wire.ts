import { z } from 'zod'

import { threadIdWireSchema } from './request-wire.js'

export const listMentionFilesParamsSchema = z.strictObject({
  threadId: threadIdWireSchema,
  directory: z.string(),
})
export type ListMentionFilesParams = z.infer<typeof listMentionFilesParamsSchema>

export const mentionFileExistsParamsSchema = z.strictObject({
  threadId: threadIdWireSchema,
  path: z.string(),
})
export type MentionFileExistsParams = z.infer<typeof mentionFileExistsParamsSchema>

export const readMentionFileParamsSchema = mentionFileExistsParamsSchema
export type ReadMentionFileParams = MentionFileExistsParams

export const mentionFileWireSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    path: z.string(),
    content: z.string(),
    truncated: z.boolean(),
  }),
  z.strictObject({ type: z.literal('listing'), path: z.string(), content: z.string() }),
  z.strictObject({ type: z.literal('refused'), path: z.string(), reason: z.string() }),
])
export type MentionFileWire = z.infer<typeof mentionFileWireSchema>

export const listMentionFilesReplySchema = z.strictObject({
  entries: z.array(z.strictObject({ name: z.string(), isDirectory: z.boolean() })),
})
export const mentionFileExistsReplySchema = z.strictObject({ exists: z.boolean() })
export const readMentionFileReplySchema = z.strictObject({ file: mentionFileWireSchema })
