import {
  ESubscriptionActor,
  ESubscriptionStatus,
  toThreadId,
  type Subscription,
} from '@dltech/atlas-core'

import {
  SubscriptionRegistryPort,
  type SubscribeOutcome,
  type SubscriptionProviderInfo,
  type SubscriptionView,
} from '../../../subscriptions/port'

export class FakeSubscriptionRegistry extends SubscriptionRegistryPort {
  readonly subscribes: {
    threadId: string
    provider: string
    input: string
    projectDirectory: string
    by: ESubscriptionActor
  }[] = []
  refusal: string | null = null

  async subscribe(args: {
    threadId: string
    provider: string
    input: string
    projectDirectory: string
    by: ESubscriptionActor
  }): Promise<SubscribeOutcome> {
    this.subscribes.push(args)
    if (this.refusal !== null) return { ok: false, error: this.refusal }
    return {
      ok: true,
      existed: false,
      subscription: {
        id: 'sub_artifact',
        provider: args.provider,
        target: args.input,
        label: `artifact ${args.input} build`,
        threadId: toThreadId(args.threadId),
        createdBy: args.by,
        status: ESubscriptionStatus.Active,
        createdAt: '2026-11-16T00:00:00.000Z',
      } satisfies Subscription,
    }
  }

  list(): readonly SubscriptionView[] {
    return []
  }

  providers(): readonly SubscriptionProviderInfo[] {
    return []
  }

  async setStatus(): Promise<boolean> {
    return true
  }

  async unsubscribe(): Promise<boolean> {
    return true
  }

  version(): number {
    return 0
  }

  onChange(): () => void {
    return () => undefined
  }
}
