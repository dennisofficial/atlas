import { z } from 'zod'

import { threadIdWireSchema } from './request-wire'

export enum EPendingEdit {
  Done = 'done',
  Missing = 'missing',
  Reserved = 'reserved',
  NotEditable = 'not-editable',
}

export const updatePendingParamsSchema = z.object({
  threadId: threadIdWireSchema,
  id: z.string().min(1),
  text: z.string().min(1),
})
export type UpdatePendingParams = z.infer<typeof updatePendingParamsSchema>

export const removePendingParamsSchema = z.object({
  threadId: threadIdWireSchema,
  id: z.string().min(1),
})
export type RemovePendingParams = z.infer<typeof removePendingParamsSchema>

export const pendingEditReplySchema = z.object({ outcome: z.enum(EPendingEdit) })
export type PendingEditReply = z.infer<typeof pendingEditReplySchema>
