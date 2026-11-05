import { z } from 'zod'

import { threadIdWireSchema } from './request-wire'

export const diagramRepairParamsSchema = z.object({
  threadId: threadIdWireSchema,
  messageId: z.string().min(1).brand<'EventId'>(),
  source: z.string().min(1),
  error: z.string(),
})
export type DiagramRepairParams = z.infer<typeof diagramRepairParamsSchema>

export const diagramRepairReplySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('repaired'), repaired: z.string().min(1) }),
  z.object({ kind: z.literal('failed'), reason: z.string() }),
])
export type DiagramRepairReply = z.infer<typeof diagramRepairReplySchema>
