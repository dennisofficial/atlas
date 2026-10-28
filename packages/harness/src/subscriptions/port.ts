import type {
  ESubscriptionActor,
  ESubscriptionStatus,
  Subscription,
  ThreadId,
} from '@dltech/atlas-core'

export type SubscriptionView = Subscription & { held: number }

export type SubscriptionProviderInfo = { kind: string; summary: string; targetHint: string }

export type SubscribeOutcome =
  | { ok: true; subscription: Subscription; existed: boolean }
  | { ok: false; error: string }

export abstract class SubscriptionRegistryPort {
  abstract list(): readonly SubscriptionView[]
  abstract providers(): readonly SubscriptionProviderInfo[]
  abstract subscribe(args: {
    threadId: ThreadId
    provider: string
    input: string
    projectDirectory: string
    by: ESubscriptionActor
    expiresAt?: string | undefined
  }): Promise<SubscribeOutcome>
  abstract setStatus(args: {
    subscriptionId: string
    status: ESubscriptionStatus
    by: ESubscriptionActor
  }): Promise<boolean>
  abstract unsubscribe(args: { subscriptionId: string; by: ESubscriptionActor }): Promise<boolean>
  abstract version(): number
  abstract onChange(listener: () => void): () => void
}
