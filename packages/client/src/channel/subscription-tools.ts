import {
  subscriptionReplySchema,
  subscriptionsWireSchema,
  type ESubscriptionStatusWire,
  type SubscriptionReply,
  type SubscriptionsWire,
} from '@dltech/atlas-wire/web'

import { EClientRequest } from './channel-wire'
import { RemoteRequestFailed, RemoteRequestLost } from './remote-channel-upstream'
import type { RemoteDeltaChannel } from './remote-delta-channel-types'

type RequestChannel = Pick<RemoteDeltaChannel, 'request'>

export const SUBSCRIPTIONS_TOO_OLD = "This session's Atlas is too old to manage subscriptions"

const refusalOf = (failure: unknown): SubscriptionReply => {
  if (failure instanceof RemoteRequestFailed) return { ok: false, error: SUBSCRIPTIONS_TOO_OLD }
  if (failure instanceof RemoteRequestLost) return { ok: false, error: failure.message }
  throw failure
}

const acted = async (args: {
  channel: RequestChannel
  op: EClientRequest
  params: unknown
}): Promise<SubscriptionReply> => {
  try {
    return subscriptionReplySchema.parse(
      await args.channel.request({ op: args.op, params: args.params }),
    )
  } catch (failure) {
    return refusalOf(failure)
  }
}

export const listSubscriptions = async (args: {
  channel: RequestChannel
}): Promise<SubscriptionsWire | null> => {
  try {
    return subscriptionsWireSchema.parse(
      await args.channel.request({ op: EClientRequest.ListSubscriptions, params: {} }),
    )
  } catch (failure) {
    if (failure instanceof RemoteRequestFailed) return null
    throw failure
  }
}

export const subscribeTo = (args: {
  channel: RequestChannel
  threadId: string
  provider: string
  input: string
  expiresAt?: string | undefined
}): Promise<SubscriptionReply> =>
  acted({
    channel: args.channel,
    op: EClientRequest.Subscribe,
    params: {
      threadId: args.threadId,
      provider: args.provider,
      input: args.input,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
    },
  })

export const setSubscriptionStatus = (args: {
  channel: RequestChannel
  subscriptionId: string
  status: ESubscriptionStatusWire
}): Promise<SubscriptionReply> =>
  acted({
    channel: args.channel,
    op: EClientRequest.SetSubscriptionStatus,
    params: { subscriptionId: args.subscriptionId, status: args.status },
  })

export const unsubscribeFrom = (args: {
  channel: RequestChannel
  subscriptionId: string
}): Promise<SubscriptionReply> =>
  acted({
    channel: args.channel,
    op: EClientRequest.Unsubscribe,
    params: { subscriptionId: args.subscriptionId },
  })
