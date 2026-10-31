import type { JsonValue } from '../json/value'
import type {
  ESubscriptionActor,
  ESubscriptionEnd,
  ESubscriptionStatus,
} from '../subscriptions/subscription'

export type SubscriptionEventBody =
  | {
      type: 'subscription-created'
      subscriptionId: string
      provider: string
      target: JsonValue
      label: string
      createdBy: ESubscriptionActor
      expiresAt?: string | undefined
    }
  | {
      type: 'subscription-changed'
      subscriptionId: string
      status: ESubscriptionStatus
      by: ESubscriptionActor
    }
  | {
      type: 'subscription-ended'
      subscriptionId: string
      reason: ESubscriptionEnd
      by: ESubscriptionActor
    }
