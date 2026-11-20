import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { CiFeedFragment } from './ci-fragment'
import { ciWatchHooks } from './ci-watch-hook'
import { podCommands } from './commands'
import { subscriptionEndHooks } from './subscription-end-hook'
import { ListSubscriptionsTool, SubscribeTool, UnsubscribeTool } from './tools'

export { CI_WATCH_DENY_REASON } from './ci-watch-hook'
export { CiFeedFragment } from './ci-fragment'
export { SUBSCRIPTION_END_HOOK } from './subscription-end-hook'
export { githubIdentityLookup } from './identity'
export type { GitIdentity, IdentityLookup } from './identity'

export const githubPod: PodSlot = {
  ...EMPTY_POD,
  childDeny: ['subscribe', 'unsubscribe', 'set-subscription-status'],
  tools: (ctx) => [
    new SubscribeTool(ctx),
    new UnsubscribeTool(ctx),
    new ListSubscriptionsTool(ctx),
  ],
  hooks: (ctx) => {
    const ci = ciWatchHooks(ctx)
    const ending = subscriptionEndHooks(ctx)
    return {
      beforeTool: ci.beforeTool,
      beforeTurn: ending.beforeTurn,
      afterTurn: ending.afterTurn,
    }
  },
  prompts: [new CiFeedFragment()],
  commands: podCommands,
}
