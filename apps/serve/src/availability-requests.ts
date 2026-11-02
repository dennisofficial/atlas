import { toAccountId } from '@dltech/atlas-core'
import type { AvailabilityControl } from '@dltech/atlas-harness'
import {
  availabilityControlRequestWireSchema,
  availabilityControlResultWireSchema,
  capabilitySetOf,
  EClientRequest,
  speaksModelAvailability,
  waitingForModelWireSchema,
  type CapabilitySet,
} from '@dltech/atlas-wire'

import { messageOf } from './message-of'
import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'

const OLD_PEER = 'Update/restart this session to manage model access'

export const isAvailabilityOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ReadModelAvailability || op === EClientRequest.ControlLocalModelAvailability

export async function answerAvailability(args: {
  frame: RequestFrame
  availability: AvailabilityControl
  capabilities: CapabilitySet
}): Promise<ReplyFrame> {
  const { frame, availability } = args
  const replyTo = frame.id
  if (!speaksModelAvailability(args.capabilities)) {
    return refusedRequest({ replyTo, message: OLD_PEER })
  }
  if (frame.op === EClientRequest.ReadModelAvailability) {
    return answeredRequest({
      replyTo,
      data: {
        waiting: availability.waiting().map((waiting) => waitingForModelWireSchema.parse(waiting)),
      },
    })
  }
  const parsed = availabilityControlRequestWireSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo,
      message: `${frame.op} wants { key, expectedGeneration, requestId, action }`,
    })
  }
  const outcome = await availability.control({
    ...parsed.data,
    key: { ...parsed.data.key, accountId: toAccountId(parsed.data.key.accountId) },
  })
  return answeredRequest({
    replyTo,
    data: availabilityControlResultWireSchema.parse(outcome),
  })
}

export function routeAvailabilityRequest(args: {
  frame: RequestFrame
  availability: AvailabilityControl | undefined
  capabilities: () => CapabilitySet | undefined
  reply: (reply: ReplyFrame) => void
}): boolean {
  const { frame, availability, reply } = args
  if (!isAvailabilityOp(frame.op)) return false
  if (availability === undefined) {
    reply(refusedRequest({ replyTo: frame.id, message: 'this serve cannot manage model access' }))
    return true
  }
  void answerAvailability({
    frame,
    availability,
    capabilities: args.capabilities() ?? capabilitySetOf(undefined),
  })
    .then(reply)
    .catch((error: unknown) =>
      reply(
        refusedRequest({
          replyTo: frame.id,
          message: messageOf(error, 'the model control failed'),
        }),
      ),
    )
  return true
}
