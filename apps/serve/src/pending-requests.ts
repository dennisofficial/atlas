import { type ThreadId } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-harness'
import type { PendingQueues } from '@dltech/atlas-harness'
import { removePendingParamsSchema, updatePendingParamsSchema } from '@dltech/atlas-wire'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'

export const isPendingEditOp = (op: EClientRequest): boolean =>
  op === EClientRequest.UpdatePending || op === EClientRequest.RemovePending

export async function answerPendingEdit(args: {
  frame: RequestFrame
  pending: PendingQueues
}): Promise<ReplyFrame> {
  const { frame, pending } = args
  if (frame.op === EClientRequest.UpdatePending) {
    const parsed = updatePendingParamsSchema.safeParse(frame.params)
    if (!parsed.success) {
      return refusedRequest({
        replyTo: frame.id,
        message: 'update-pending wants { threadId, id, text }',
      })
    }
    const queue = pending.forThread({ threadId: parsed.data.threadId as ThreadId })
    const outcome = queue.update({ id: parsed.data.id, text: parsed.data.text })
    return answeredRequest({ replyTo: frame.id, data: { outcome } })
  }

  const parsed = removePendingParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo: frame.id, message: 'remove-pending wants { threadId, id }' })
  }
  const queue = pending.forThread({ threadId: parsed.data.threadId as ThreadId })
  return answeredRequest({
    replyTo: frame.id,
    data: { outcome: queue.remove({ id: parsed.data.id }) },
  })
}
