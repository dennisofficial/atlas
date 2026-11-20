import { EStage, type EventDraft, type HookOutcome } from '@dltech/atlas-core'
import type { HookChainArgs } from '@dltech/atlas-agent'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { subscriptionEndingsOf } from '../core'

export const SUBSCRIPTION_END_HOOK = 'github-end-subscriptions'

const endingOutcome = (ctx: PluginPodContext): HookOutcome => {
  const drafts: EventDraft[] = subscriptionEndingsOf({
    events: ctx.events(),
    now: new Date(),
  }).map((ending) => ({
    type: 'subscription-ended',
    subscriptionId: ending.subscriptionId,
    reason: ending.reason,
    by: ending.by,
  }))
  return drafts.length === 0 ? {} : { drafts }
}

export const subscriptionEndHooks = (ctx: PluginPodContext): HookChainArgs => ({
  beforeTurn: [
    {
      name: SUBSCRIPTION_END_HOOK,
      order: { stage: EStage.Observe, nudge: 0 },
      run: async () => endingOutcome(ctx),
    },
  ],
  afterTurn: [
    {
      name: `${SUBSCRIPTION_END_HOOK}-after-turn`,
      order: { stage: EStage.Observe, nudge: 0 },
      run: async () => endingOutcome(ctx),
    },
  ],
})
