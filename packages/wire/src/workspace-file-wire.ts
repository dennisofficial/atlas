import { z } from 'zod'

export const readWorkspaceFileParamsSchema = z.strictObject({
  path: z.string(),
})
export type ReadWorkspaceFileParams = z.infer<typeof readWorkspaceFileParamsSchema>

export const workspaceFileWireSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    path: z.string(),
    content: z.string(),
    truncated: z.boolean(),
    bytes: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('refused'),
    path: z.string(),
    reason: z.string(),
  }),
])
export type WorkspaceFileWire = z.infer<typeof workspaceFileWireSchema>

export const readWorkspaceFileReplySchema = z.strictObject({
  file: workspaceFileWireSchema,
})
export type ReadWorkspaceFileReply = z.infer<typeof readWorkspaceFileReplySchema>
