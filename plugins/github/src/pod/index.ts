import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { CiFeedFragment } from './ci-fragment'
import { ciWatchHooks } from './ci-watch-hook'
import { githubSubscriptionEnds } from '../core'
import { podCommands } from './commands'
import { SubscriptionTool } from './tools'

export { CI_WATCH_DENY_REASON } from './ci-watch-hook'
export { CiFeedFragment } from './ci-fragment'
export { githubIdentityLookup } from './identity'
export type { GitIdentity, IdentityLookup } from './identity'

export const githubPod: PodSlot = {
  ...EMPTY_POD,
  childDeny: ['subscription', 'set-subscription-status'],
  tools: (ctx) => [new SubscriptionTool(ctx)],
  hooks: ciWatchHooks,
  subscriptionEnds: githubSubscriptionEnds,
  prompts: [new CiFeedFragment()],
  commands: podCommands,
}
