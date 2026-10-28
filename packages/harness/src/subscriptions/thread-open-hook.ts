import { EStage, OnThreadOpenHook, type HookOutcome, type OnThreadOpen } from '@dltech/atlas-core'

import type { SubscriptionRegistry } from './registry'

export class SubscriptionThreadOpenHook extends OnThreadOpenHook {
  readonly name = 'subscriptions-thread-open'
  readonly order = { stage: EStage.Observe, nudge: 0 }

  constructor(private readonly registry: SubscriptionRegistry) {
    super()
  }

  readonly run = async ({ threadId }: Parameters<OnThreadOpen>[0]): Promise<HookOutcome> => {
    await this.registry.load({ threadId })
    return {}
  }
}
