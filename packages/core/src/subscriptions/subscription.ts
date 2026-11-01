import type { Event } from '../events/envelope'
import type { ThreadId } from '../events/ids'
import type { JsonValue } from '../json/value'

export enum ESubscriptionStatus {
  Active = 'active',
  Paused = 'paused',
}

export enum ESubscriptionActor {
  Agent = 'agent',
  Operator = 'operator',
  Provider = 'provider',
  Clock = 'clock',
}

export enum ESubscriptionEnd {
  Unsubscribed = 'unsubscribed',
  Expired = 'expired',
  Completed = 'completed',
  Archived = 'archived',
}

export type Subscription = {
  id: string
  provider: string
  target: JsonValue
  label: string
  threadId: ThreadId
  createdBy: ESubscriptionActor
  status: ESubscriptionStatus
  expiresAt?: string | undefined
  createdAt: string
}

export const sameTarget = (a: JsonValue, b: JsonValue): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export function subscriptionsOf(events: readonly Event[]): readonly Subscription[] {
  const live = new Map<string, Subscription>()

  for (const event of events) {
    if (event.type === 'subscription-created') {
      live.set(event.subscriptionId, {
        id: event.subscriptionId,
        provider: event.provider,
        target: event.target,
        label: event.label,
        threadId: event.threadId,
        createdBy: event.createdBy,
        status: ESubscriptionStatus.Active,
        expiresAt: event.expiresAt,
        createdAt: event.at,
      })
      continue
    }

    if (event.type === 'subscription-changed') {
      const current = live.get(event.subscriptionId)
      if (current !== undefined) live.set(current.id, { ...current, status: event.status })
      continue
    }

    if (event.type === 'subscription-ended') live.delete(event.subscriptionId)
  }

  return [...live.values()]
}
