import { EServeFrame } from '@dltech/atlas-harness'

import { answerContextRead, isContextOp, type ContextReaders } from './context-requests'
import { messageOf } from './message-of'
import { refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const routeContextRead = (args: {
  frame: RequestFrame
  context: ContextReaders | undefined
  reply: (reply: ReplyFrame) => void
}): boolean => {
  const { frame, context, reply } = args
  if (!isContextOp(frame.op)) return false
  if (context === undefined) {
    reply(
      refusedRequest({
        replyTo: frame.id,
        message: 'this serve has no context folder to read',
      }),
    )
    return true
  }
  void answerContextRead({ frame, context })
    .then(reply)
    .catch((error: unknown) =>
      reply({
        kind: EServeFrame.Reply,
        replyTo: frame.id,
        ok: false,
        data: { message: messageOf(error, 'the context read failed') },
      }),
    )
  return true
}
