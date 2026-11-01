import { z } from 'zod'

import { listContextFilesReplySchema, readContextFileReplySchema } from './request-wire'

export const contextFilePutSchema = z.strictObject({
  threadId: z.string().min(1).optional(),
  path: z.string().min(1),
  content: z.string(),
})
export type ContextFilePut = z.infer<typeof contextFilePutSchema>

export const contextFileDeleteSchema = z.strictObject({
  threadId: z.string().min(1).optional(),
  path: z.string().min(1),
})
export type ContextFileDelete = z.infer<typeof contextFileDeleteSchema>

export const contextFilesDeleteMissingSchema = z.strictObject({
  threadId: z.string().min(1).optional(),
  keep: z.array(z.string().min(1)),
})
export type ContextFilesDeleteMissing = z.infer<typeof contextFilesDeleteMissingSchema>

export const contextFilesListInputSchema = z.strictObject({
  threadId: z.string().min(1),
  directory: z.string().optional(),
})
export type ContextFilesListInput = z.infer<typeof contextFilesListInputSchema>

export const contextFileReadInputSchema = z.strictObject({
  threadId: z.string().min(1),
  path: z.string().min(1),
})
export type ContextFileReadInput = z.infer<typeof contextFileReadInputSchema>

export const contextFilesListReplySchema = listContextFilesReplySchema
export const contextFileReadReplySchema = readContextFileReplySchema
