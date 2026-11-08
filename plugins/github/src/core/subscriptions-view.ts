import {
  ESubscriptionActor,
  ESubscriptionStatus,
  type Event,
  type PluginViewFold,
  type V2Event,
} from '@dltech/atlas-core'
import { z } from 'zod'

export const SUBSCRIPTIONS_VIEW = 'subscriptions'

export const subscriptionRowSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  target: z.unknown(),
  label: z.string(),
  threadId: z.string().min(1),
  createdBy: z.enum(ESubscriptionActor),
  status: z.enum(ESubscriptionStatus),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
})

export const subscriptionsViewSchema = z.array(subscriptionRowSchema).readonly()

export type SubscriptionRow = z.infer<typeof subscriptionRowSchema>
export type SubscriptionsViewState = readonly SubscriptionRow[]

export const foldSubscriptions = (
  state: SubscriptionsViewState,
  event: Event | V2Event,
): SubscriptionsViewState => {
  if (event.type === 'subscription-created') {
    const row: SubscriptionRow = {
      id: event.subscriptionId,
      provider: event.provider,
      target: event.target,
      label: event.label,
      threadId: event.threadId,
      createdBy: event.createdBy,
      status: ESubscriptionStatus.Active,
      ...(event.expiresAt === undefined ? {} : { expiresAt: event.expiresAt }),
      createdAt: event.at,
    }
    return [...state.filter((kept) => kept.id !== row.id), row]
  }
  if (event.type === 'subscription-changed') {
    return state.map((kept) =>
      kept.id === event.subscriptionId ? { ...kept, status: event.status } : kept,
    )
  }
  if (event.type === 'subscription-ended') {
    return state.filter((kept) => kept.id !== event.subscriptionId)
  }
  return state
}

export const subscriptionsView: PluginViewFold<SubscriptionsViewState> = {
  name: SUBSCRIPTIONS_VIEW,
  initial: [],
  fold: foldSubscriptions,
}

export const subscriptionsOfEvents = (
  events: readonly (Event | V2Event)[],
): SubscriptionsViewState => events.reduce(foldSubscriptions, subscriptionsView.initial)
