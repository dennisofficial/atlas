import { z } from 'zod'

export const confirmWorkspaceCleanupParamsSchema = z.strictObject({ generation: z.string().min(1) })

export const confirmWorkspaceCleanupReplySchema = z.object({
  safe: z.boolean(),
  reasons: z.array(z.string()),
  sourceSessionId: z.string(),
})

export type ConfirmWorkspaceCleanupReply = z.infer<typeof confirmWorkspaceCleanupReplySchema>
