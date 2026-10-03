import { EClientRequest, EServeFrame, provideOperatorInputParamsSchema, type ServeFrame } from '@dltech/atlas-wire'

import type { OperatorInputPort } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const isOperatorInputOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ProvideOperatorInput

export const operatorInputSnapshot = (args: {
  operatorInput: Pick<OperatorInputPort, 'pending'>
  threadId: ThreadId
  seq: number
}): ServeFrame => ({
  kind: EServeFrame.Signal,
  seq: Math.max(0, args.seq - 1),
  signal: { type: 'operator-input', request: args.operatorInput.pending({ threadId: args.threadId }) },
})

export function routeOperatorInput(args: {
  frame: RequestFrame
  threadId: ThreadId
  operatorInput?: Pick<OperatorInputPort, 'answer'> | undefined
  reply: (frame: ReplyFrame) => void
}): boolean {
  if (!isOperatorInputOp(args.frame.op)) return false
  if (args.operatorInput === undefined) {
    args.reply(refusedRequest({ replyTo: args.frame.id, message: 'this serve holds no operator input requests' }))
    return true
  }
  void answerOperatorInput({ frame: args.frame, threadId: args.threadId, operatorInput: args.operatorInput })
    .then(args.reply)
    .catch(() => args.reply(refusedRequest({ replyTo: args.frame.id, message: 'the operator input answer failed' })))
  return true
}

export const answerOperatorInput = async (args: {
  frame: RequestFrame
  threadId: ThreadId
  operatorInput: Pick<OperatorInputPort, 'answer'>
}): Promise<ReplyFrame> => {
  const { frame, operatorInput } = args

  const parsed = provideOperatorInputParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'provide-operator-input wants { requestId, value }',
    })
  }
  const outcome = await operatorInput.answer({
    threadId: args.threadId,
    requestId: parsed.data.requestId,
    value: parsed.data.value,
  })
  if (!outcome.ok) {
    return refusedRequest({ replyTo: frame.id, message: outcome.reason })
  }
  return answeredRequest({
    replyTo: frame.id,
    data: { delivered: true, bytes: outcome.bytes },
  })
}
