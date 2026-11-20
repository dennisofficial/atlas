import type { Event } from '../events/envelope'
import type { JsonValue } from '../json/value'
import type { V2Event } from '../record/event'
import { ESubscriptionActor, ESubscriptionEnd } from './subscription'

export type SubscriptionEndRule = (args: { target: JsonValue; event: Event | V2Event }) => boolean

export type SubscriptionEndRules = Readonly<Record<string, SubscriptionEndRule>>

export type SubscriptionEnding = {
  subscriptionId: string
  reason: ESubscriptionEnd
  by: ESubscriptionActor
}

type CreatedEvent = Extract<Event | V2Event, { type: 'subscription-created' }>

type LiveSubscription = {
  provider: string
  target: JsonValue
  expiresAt?: string | undefined
}

const expiryOf = (subscription: LiveSubscription): number | null => {
  if (subscription.expiresAt === undefined) return null
  const at = Date.parse(subscription.expiresAt)
  return Number.isFinite(at) ? at : null
}

const completedIds = (args: {
  live: ReadonlyMap<string, LiveSubscription>
  event: Event | V2Event
  rules: SubscriptionEndRules
}): string[] => {
  const ids: string[] = []
  for (const [id, subscription] of args.live) {
    const rule = args.rules[subscription.provider]
    if (rule === undefined) continue
    if (rule({ target: subscription.target, event: args.event })) ids.push(id)
  }
  return ids
}

const liveOf = (event: CreatedEvent): LiveSubscription => ({
  provider: event.provider,
  target: event.target,
  ...(event.expiresAt === undefined ? {} : { expiresAt: event.expiresAt }),
})

export const subscriptionEndingsOf = (args: {
  events: readonly (Event | V2Event)[]
  now: Date
  rules: SubscriptionEndRules
}): SubscriptionEnding[] => {
  const endings = new Map<string, SubscriptionEnding>()
  const live = new Map<string, LiveSubscription>()

  for (const event of args.events) {
    if (event.type === 'subscription-created') {
      live.set(event.subscriptionId, liveOf(event))
      endings.delete(event.subscriptionId)
      continue
    }
    if (event.type === 'subscription-ended') {
      live.delete(event.subscriptionId)
      endings.delete(event.subscriptionId)
      continue
    }
    for (const id of completedIds({ live, event, rules: args.rules })) {
      endings.set(id, {
        subscriptionId: id,
        reason: ESubscriptionEnd.Completed,
        by: ESubscriptionActor.Provider,
      })
      live.delete(id)
    }
  }

  for (const [id, subscription] of live) {
    const expiresAt = expiryOf(subscription)
    if (expiresAt === null || expiresAt > args.now.getTime()) continue
    endings.set(id, {
      subscriptionId: id,
      reason: ESubscriptionEnd.Expired,
      by: ESubscriptionActor.Clock,
    })
  }

  return [...endings.values()]
}
