import { EKilledBy } from '@dltech/atlas-core'
import {
  EClientRequest,
  resumeAgentParamsSchema,
  sayToAgentParamsSchema,
  stopAgentParamsSchema,
} from '@dltech/atlas-wire'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'
import type { ServeAgentSteer } from './serve-app'

export const isAgentSteerOp = (op: EClientRequest): boolean =>
  op === EClientRequest.SayToAgent ||
  op === EClientRequest.ResumeAgent ||
  op === EClientRequest.StopAgent

export const answerAgentSteer = async (args: {
  frame: RequestFrame
  agents: ServeAgentSteer
}): Promise<ReplyFrame> => {
  const { frame, agents } = args

  if (frame.op === EClientRequest.SayToAgent) {
    const parsed = sayToAgentParamsSchema.safeParse(frame.params)
    if (!parsed.success) {
      return refusedRequest({ replyTo: frame.id, message: 'say-to-agent wants { threadId, agentId, text, images?, files? }' })
    }
    const outcome = await agents.say(parsed.data)
    return answeredRequest({ replyTo: frame.id, data: outcome })
  }

  if (frame.op === EClientRequest.ResumeAgent) {
    const parsed = resumeAgentParamsSchema.safeParse(frame.params)
    if (!parsed.success) {
      return refusedRequest({ replyTo: frame.id, message: 'resume-agent wants { threadId, agentId }' })
    }
    const outcome = await agents.resume(parsed.data)
    return answeredRequest({ replyTo: frame.id, data: outcome })
  }

  const parsed = stopAgentParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo: frame.id, message: 'stop-agent wants { threadId, agentId }' })
  }
  const outcome = await agents.stop({ ...parsed.data, by: EKilledBy.User })
  return answeredRequest({ replyTo: frame.id, data: outcome })
}
