import { z } from 'zod'

export const MAX_FILE_SEARCH_LIMIT = 200
export const DEFAULT_FILE_SEARCH_LIMIT = 100

export const searchWorkspaceFilesParamsSchema = z.strictObject({
  query: z.string(),
  limit: z.number().int().positive().max(MAX_FILE_SEARCH_LIMIT).optional(),
})
export type SearchWorkspaceFilesParams = z.infer<typeof searchWorkspaceFilesParamsSchema>

export const fileSearchMatchWireSchema = z.strictObject({
  path: z.string(),
  positions: z.array(z.number().int().nonnegative()),
})
export type FileSearchMatchWire = z.infer<typeof fileSearchMatchWireSchema>

export const searchWorkspaceFilesReplySchema = z.strictObject({
  paths: z.array(fileSearchMatchWireSchema),
  truncated: z.boolean(),
})
export type SearchWorkspaceFilesReply = z.infer<typeof searchWorkspaceFilesReplySchema>
