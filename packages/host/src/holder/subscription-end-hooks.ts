import type { HookChainArgs } from '@dltech/atlas-agent'
import {
  EStage,
  subscriptionEndingsOf,
  type EventDraft,
  type HookOutcome,
  type SubscriptionEndRules,
  type V2Event,
} from '@dltech/atlas-core'

export const SUBSCRIPTION_END_HOOK = 'subscription-endings'

type EndHookArgs = {
  rules: SubscriptionEndRules
  events: () => readonly V2Event[]
  now: () => Date
}

const endingOutcome = (args: EndHookArgs): HookOutcome => {
  const drafts: EventDraft[] = subscriptionEndingsOf({
    events: args.events(),
    now: args.now(),
    rules: args.rules,
  }).map((ending) => ({
    type: 'subscription-ended',
    subscriptionId: ending.subscriptionId,
    reason: ending.reason,
    by: ending.by,
  }))
  return drafts.length === 0 ? {} : { drafts }
}

export const subscriptionEndHooksOf = (args: EndHookArgs): HookChainArgs => ({
  beforeTurn: [
    {
      name: SUBSCRIPTION_END_HOOK,
      order: { stage: EStage.Observe, nudge: 0 },
      run: async () => endingOutcome(args),
    },
  ],
  afterTurn: [
    {
      name: `${SUBSCRIPTION_END_HOOK}-after-turn`,
      order: { stage: EStage.Observe, nudge: 0 },
      run: async () => endingOutcome(args),
    },
  ],
})
