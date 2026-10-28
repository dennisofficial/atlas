import { ESubscriptionActor, ESubscriptionStatus, toThreadId } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-harness'
import {
  ESubscriptionStatusWire,
  setSubscriptionStatusParamsSchema,
  subscribeParamsSchema,
  subscriptionRecordWireSchema,
  subscriptionsWireSchema,
  unsubscribeParamsSchema,
  type SubscriptionReply,
  type SubscriptionsWire,
} from '@dltech/atlas-wire'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'
import type { ServeSubscriptions } from './serve-app'

export const isSubscriptionOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ListSubscriptions ||
  op === EClientRequest.Subscribe ||
  op === EClientRequest.SetSubscriptionStatus ||
  op === EClientRequest.Unsubscribe

export const subscriptionsSnapshot = (subscriptions: ServeSubscriptions): SubscriptionsWire =>
  subscriptionsWireSchema.parse({
    subscriptions: subscriptions.registry.list(),
    providers: subscriptions.registry.providers(),
  })

const NO_SUCH_SUBSCRIPTION = 'No such subscription'

const replied = (args: { frame: RequestFrame; reply: SubscriptionReply }): ReplyFrame =>
  answeredRequest({ replyTo: args.frame.id, data: args.reply })

const outcomeOf = (done: boolean): SubscriptionReply =>
  done ? { ok: true } : { ok: false, error: NO_SUCH_SUBSCRIPTION }

const wanted = (args: { frame: RequestFrame; shape: string }): ReplyFrame =>
  refusedRequest({ replyTo: args.frame.id, message: `${args.frame.op} wants ${args.shape}` })

export async function answerSubscription(args: {
  frame: RequestFrame
  subscriptions: ServeSubscriptions
}): Promise<ReplyFrame> {
  const { frame, subscriptions } = args
  const { registry, projectDirectory } = subscriptions

  if (frame.op === EClientRequest.ListSubscriptions) {
    return answeredRequest({ replyTo: frame.id, data: subscriptionsSnapshot(subscriptions) })
  }

  if (frame.op === EClientRequest.Subscribe) {
    const parsed = subscribeParamsSchema.safeParse(frame.params)
    if (!parsed.success) return wanted({ frame, shape: '{ threadId, provider, input }' })

    const outcome = await registry.subscribe({
      threadId: toThreadId(parsed.data.threadId),
      provider: parsed.data.provider,
      input: parsed.data.input,
      projectDirectory,
      by: ESubscriptionActor.Operator,
      expiresAt: parsed.data.expiresAt,
    })
    if (!outcome.ok) return replied({ frame, reply: { ok: false, error: outcome.error } })

    return replied({
      frame,
      reply: {
        ok: true,
        subscription: subscriptionRecordWireSchema.parse(outcome.subscription),
        existed: outcome.existed,
      },
    })
  }

  if (frame.op === EClientRequest.SetSubscriptionStatus) {
    const parsed = setSubscriptionStatusParamsSchema.safeParse(frame.params)
    if (!parsed.success) return wanted({ frame, shape: '{ subscriptionId, status }' })

    const done = await registry.setStatus({
      subscriptionId: parsed.data.subscriptionId,
      status:
        parsed.data.status === ESubscriptionStatusWire.Paused
          ? ESubscriptionStatus.Paused
          : ESubscriptionStatus.Active,
      by: ESubscriptionActor.Operator,
    })
    return replied({ frame, reply: outcomeOf(done) })
  }

  const parsed = unsubscribeParamsSchema.safeParse(frame.params)
  if (!parsed.success) return wanted({ frame, shape: '{ subscriptionId }' })

  const done = await registry.unsubscribe({
    subscriptionId: parsed.data.subscriptionId,
    by: ESubscriptionActor.Operator,
  })
  return replied({ frame, reply: outcomeOf(done) })
}
