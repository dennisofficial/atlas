import type { EventDraft, JsonValue, Subscription, ThreadId } from '@dltech/atlas-core'

export enum EOccurrenceUrgency {
  Now = 'now',
  Batch = 'batch',
}

export type SubscriptionOccurrence = {
  key: string
  urgency: EOccurrenceUrgency
  settles?: boolean
  ends?: boolean
  draft: EventDraft
}

export type ResolvedTarget = { target: JsonValue; label: string }

export type SubscriptionProvider = {
  readonly kind: string
  readonly summary: string
  readonly targetHint: string
  resolve: (args: {
    input: string
    threadId: ThreadId
    projectDirectory: string
  }) => Promise<ResolvedTarget | { error: string }>
  start: (args: {
    subscription: Subscription
    emit: (occurrence: SubscriptionOccurrence) => void
  }) => () => void
}
