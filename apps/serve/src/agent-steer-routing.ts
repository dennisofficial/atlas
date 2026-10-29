import { EServeFrame } from '@dltech/atlas-harness'

import { answerAgentSteer, isAgentSteerOp } from './agent-steer'
import { messageOf } from './message-of'
import { refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import type { ServeAgentSteer } from './serve-app'

export const routeAgentSteerRequest = (args: {
  frame: RequestFrame
  agents: ServeAgentSteer | undefined
  run: (work: () => Promise<ReplyFrame>) => Promise<ReplyFrame>
  reply: (reply: ReplyFrame) => void
}): boolean => {
  const { frame, agents, run, reply } = args
  if (!isAgentSteerOp(frame.op)) return false
  if (agents === undefined) {
    reply(
      refusedRequest({
        replyTo: frame.id,
        message: 'this serve holds no agents to steer',
      }),
    )
    return true
  }
  void run(() => answerAgentSteer({ frame, agents }))
    .then(reply)
    .catch((error: unknown) =>
      reply({
        kind: EServeFrame.Reply,
        replyTo: frame.id,
        ok: false,
        data: { message: messageOf(error, 'the agent steer failed') },
      }),
    )
  return true
}
