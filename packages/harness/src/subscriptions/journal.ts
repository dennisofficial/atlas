import { randomUUID } from 'node:crypto'

import {
  ESubscriptionActor,
  ESubscriptionEnd,
  subscriptionsOf,
  type ESubscriptionStatus,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type JsonValue,
  type Subscription,
} from '@dltech/atlas-core'

import { messageOf } from './provider-runs'

export const newSubscriptionId = (): string => `sub_${randomUUID()}`

export type Ending = {
  id: string
  reason: ESubscriptionEnd
  by: ESubscriptionActor
  keepReady: boolean
}

export const COMPLETED = {
  reason: ESubscriptionEnd.Completed,
  by: ESubscriptionActor.Provider,
  keepReady: true,
}
export const EXPIRED = {
  reason: ESubscriptionEnd.Expired,
  by: ESubscriptionActor.Clock,
  keepReady: false,
}

export type NewSubscription = {
  subscriptionId: string
  provider: string
  target: JsonValue
  label: string
  createdBy: ESubscriptionActor
  expiresAt?: string | undefined
}

export class SubscriptionJournal {
  constructor(
    private readonly deps: {
      log: EventLogPort
      ids: IdPort
      warn: (message: string) => void
    },
  ) {}

  async created({
    owner,
    fields,
  }: {
    owner: Subscription['threadId']
    fields: NewSubscription
  }): Promise<Subscription | { error: string }> {
    try {
      const events = await this.write({
        threadId: owner,
        draft: { type: 'subscription-created', ...fields },
      })
      return subscriptionsOf(events)[0] ?? { error: 'the subscription was not recorded' }
    } catch (cause) {
      return { error: `could not record the subscription: ${messageOf(cause)}` }
    }
  }

  changed({
    subscription,
    status,
    by,
  }: {
    subscription: Subscription
    status: ESubscriptionStatus
    by: ESubscriptionActor
  }): Promise<boolean> {
    return this.recorded({
      threadId: subscription.threadId,
      what: `the status of ${subscription.id}`,
      draft: { type: 'subscription-changed', subscriptionId: subscription.id, status, by },
    })
  }

  ended({
    subscription,
    reason,
    by,
  }: {
    subscription: Subscription
    reason: ESubscriptionEnd
    by: ESubscriptionActor
  }): Promise<boolean> {
    return this.recorded({
      threadId: subscription.threadId,
      what: `the end of ${subscription.id}`,
      draft: { type: 'subscription-ended', subscriptionId: subscription.id, reason, by },
    })
  }

  private async recorded({
    threadId,
    what,
    draft,
  }: {
    threadId: Subscription['threadId']
    what: string
    draft: EventDraft
  }): Promise<boolean> {
    try {
      await this.write({ threadId, draft })
      return true
    } catch (cause) {
      this.deps.warn(`could not record ${what}: ${messageOf(cause)}`)
      return false
    }
  }

  private write({ threadId, draft }: { threadId: Subscription['threadId']; draft: EventDraft }) {
    return this.deps.log.append({
      threadId,
      runId: this.deps.ids.nextRunId(),
      drafts: [draft],
    })
  }
}
