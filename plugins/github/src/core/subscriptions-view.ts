import {
  ESubscriptionActor,
  ESubscriptionStatus,
  presentSubscription,
  subscriptionPresentationSchema,
  type Event,
  type PluginViewFold,
  type SubscriptionPresentation,
  type RecordEvent,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { githubPresenters } from './presentation'

export const SUBSCRIPTIONS_VIEW = 'subscriptions'

export const subscriptionRowSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  target: z.unknown(),
  label: z.string(),
  threadId: z.string().min(1),
  createdBy: z.enum(ESubscriptionActor),
  events: z.array(z.string()).readonly().default([]),
  createdAt: z.string(),
  held: z.number().int().min(0).default(0),
  presentation: subscriptionPresentationSchema,
})

export const subscriptionsViewSchema = z.array(subscriptionRowSchema).readonly()

export type SubscriptionRow = z.infer<typeof subscriptionRowSchema>
export type SubscriptionsViewState = readonly SubscriptionRow[]

type SubscriptionRowFields = Omit<SubscriptionRow, 'held' | 'presentation'>

const presented = (row: SubscriptionRowFields): SubscriptionPresentation =>
  presentSubscription({
    input: {
      provider: row.provider,
      label: row.label,
      target: row.target,
      // Glossary: status is v1's active/paused field; a v2 subscription is live or gone.
      status: ESubscriptionStatus.Active,
      events: row.events,
    },
    presenters: githubPresenters,
  })

export const foldSubscriptions = (
  state: SubscriptionsViewState,
  event: Event | RecordEvent,
): SubscriptionsViewState => {
  if (event.type === 'subscription-created') {
    const fields: SubscriptionRowFields = {
      id: event.subscriptionId,
      provider: event.provider,
      target: event.target,
      label: event.label,
      threadId: event.threadId,
      createdBy: event.createdBy,
      events: event.events ?? [],
      createdAt: event.at,
    }
    const row: SubscriptionRow = { ...fields, held: 0, presentation: presented(fields) }
    return [...state.filter((kept) => kept.id !== row.id), row]
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
  events: readonly (Event | RecordEvent)[],
): SubscriptionsViewState => events.reduce(foldSubscriptions, subscriptionsView.initial)
