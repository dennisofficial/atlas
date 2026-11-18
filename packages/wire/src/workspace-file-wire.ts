import { fileContentSchema } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const readWorkspaceFileParamsSchema = z.strictObject({
  path: z.string(),
})
export type ReadWorkspaceFileParams = z.infer<typeof readWorkspaceFileParamsSchema>

export const workspaceFileWireSchema = fileContentSchema
export type WorkspaceFileWire = z.infer<typeof workspaceFileWireSchema>

export const readWorkspaceFileReplySchema = z.strictObject({
  file: workspaceFileWireSchema,
})
export type ReadWorkspaceFileReply = z.infer<typeof readWorkspaceFileReplySchema>
