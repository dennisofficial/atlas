import { messageOf } from './message-of'
import { refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import { answerSessionTool, isSessionToolOp, type SessionTools } from './session-tool-requests'

export const routeSessionToolRequest = (args: {
  frame: RequestFrame
  tools: SessionTools | undefined
  reply: (reply: ReplyFrame) => void
}): boolean => {
  const { frame, tools, reply } = args
  if (!isSessionToolOp(frame.op)) return false
  void answerSessionTool({ frame, tools: tools ?? {} })
    .then(reply)
    .catch((error: unknown) =>
      reply(
        refusedRequest({
          replyTo: frame.id,
          message: messageOf(error, 'the session tool failed'),
        }),
      ),
    )
  return true
}
