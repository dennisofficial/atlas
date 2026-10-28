import { z } from 'zod'

import { threadIdWireSchema } from './request-wire'

export const PULL_REQUEST_SUBSCRIPTION_PROVIDER = 'github.pull-request'

export enum ESubscriptionStatusWire {
  Active = 'active',
  Paused = 'paused',
}

export enum ESubscriptionActorWire {
  Agent = 'agent',
  Operator = 'operator',
  Provider = 'provider',
  Clock = 'clock',
}

export const subscriptionRecordWireSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  target: z.json(),
  label: z.string(),
  threadId: threadIdWireSchema,
  createdBy: z.enum(ESubscriptionActorWire),
  status: z.enum(ESubscriptionStatusWire),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
})

export type SubscriptionRecordWire = z.infer<typeof subscriptionRecordWireSchema>

export const subscriptionWireSchema = subscriptionRecordWireSchema.extend({
  held: z.number().int().nonnegative(),
})

export type SubscriptionWire = z.infer<typeof subscriptionWireSchema>

export const subscriptionProviderWireSchema = z.object({
  kind: z.string().min(1),
  summary: z.string(),
  targetHint: z.string(),
})

export type SubscriptionProviderWire = z.infer<typeof subscriptionProviderWireSchema>

export const subscriptionsWireSchema = z.object({
  subscriptions: z.array(subscriptionWireSchema),
  providers: z.array(subscriptionProviderWireSchema),
})

export type SubscriptionsWire = z.infer<typeof subscriptionsWireSchema>

export const EMPTY_SUBSCRIPTIONS: SubscriptionsWire = { subscriptions: [], providers: [] }

export const subscribeParamsSchema = z.object({
  threadId: threadIdWireSchema,
  provider: z.string().min(1),
  input: z.string(),
  expiresAt: z.string().optional(),
})
export type SubscribeParams = z.infer<typeof subscribeParamsSchema>

export const setSubscriptionStatusParamsSchema = z.object({
  subscriptionId: z.string().min(1),
  status: z.enum(ESubscriptionStatusWire),
})
export type SetSubscriptionStatusParams = z.infer<typeof setSubscriptionStatusParamsSchema>

export const unsubscribeParamsSchema = z.object({ subscriptionId: z.string().min(1) })
export type UnsubscribeParams = z.infer<typeof unsubscribeParamsSchema>

export const subscriptionReplySchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  subscription: subscriptionRecordWireSchema.optional(),
  existed: z.boolean().optional(),
})
export type SubscriptionReply = z.infer<typeof subscriptionReplySchema>
