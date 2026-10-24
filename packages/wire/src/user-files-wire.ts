import { z } from 'zod'

export enum EUserFileTree {
  Skills = 'skills',
  Instructions = 'instructions',
  Memory = 'memory',
}

export const MAX_PATHS_PER_GET = 500

export const userFileTreeSchema = z.enum(EUserFileTree)

export const userFileMetaSchema = z.object({
  path: z.string().min(1),
  revision: z.number().int().min(0),
  contentHash: z.string(),
  tombstonedAt: z.string().nullable(),
})
export type UserFileMeta = z.infer<typeof userFileMetaSchema>

export const userFileWithContentSchema = userFileMetaSchema.extend({
  content: z.string().nullable(),
})
export type UserFileWithContent = z.infer<typeof userFileWithContentSchema>

export const userFilesListRequestSchema = z.object({
  tree: userFileTreeSchema,
  sinceRevision: z.number().int().min(0).optional(),
})
export type UserFilesListRequest = z.infer<typeof userFilesListRequestSchema>

export const userFilesListReplySchema = z.object({ files: z.array(userFileMetaSchema) })

export const userFilesGetRequestSchema = z.object({
  tree: userFileTreeSchema,
  paths: z.array(z.string()).min(1).max(MAX_PATHS_PER_GET),
})
export type UserFilesGetRequest = z.infer<typeof userFilesGetRequestSchema>

export const userFilesGetReplySchema = z.object({ files: z.array(userFileWithContentSchema) })

export const userFilePutRequestSchema = z.object({
  tree: userFileTreeSchema,
  path: z.string(),
  content: z.string(),
  contentHash: z.string(),
  baseRevision: z.number().int().min(0).optional(),
})
export type UserFilePutRequest = z.infer<typeof userFilePutRequestSchema>

export const userFileRemoveRequestSchema = z.object({
  tree: userFileTreeSchema,
  path: z.string(),
  baseRevision: z.number().int().min(0),
})
export type UserFileRemoveRequest = z.infer<typeof userFileRemoveRequestSchema>

export const userFileRevisionSchema = z.object({ revision: z.number().int().min(0) })
export type UserFileRevision = z.infer<typeof userFileRevisionSchema>
