import { z } from 'zod'

export const sessionMirrorFileSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().safe().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export type SessionMirrorFile = z.infer<typeof sessionMirrorFileSchema>

export const sessionManifestReplySchema = z.object({
  revision: z.number().int().nonnegative(),
  files: z.array(sessionMirrorFileSchema),
})
export type SessionManifestReply = z.infer<typeof sessionManifestReplySchema>

export const readSessionFilesParamsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(256),
})
export type ReadSessionFilesParams = z.infer<typeof readSessionFilesParamsSchema>

export const sessionFileContentSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(['utf8', 'base64']),
  content: z.string(),
})
export type SessionFileContent = z.infer<typeof sessionFileContentSchema>

export const readSessionFilesReplySchema = z.object({
  revision: z.number().int().positive(),
  files: z.array(sessionFileContentSchema),
  missing: z.array(z.string()),
})
export type ReadSessionFilesReply = z.infer<typeof readSessionFilesReplySchema>

export const SESSION_MIRROR_SIGNAL = 'session-files-changed'
