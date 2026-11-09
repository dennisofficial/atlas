import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { CiFeedFragment } from './ci-fragment'
import { ciWatchHooks } from './ci-watch-hook'
import { podCommands } from './commands'
import { ListSubscriptionsTool, SubscribeTool, UnsubscribeTool } from './tools'

export { CI_WATCH_DENY_REASON } from './ci-watch-hook'
export { CiFeedFragment } from './ci-fragment'
export { GithubPullRequestFinder } from './finder'
export type {
  FoundPullRequest,
  GithubTokenSource,
  PullRequestFinder,
} from './finder'
export { githubIdentityLookup } from './identity'
export type { GitIdentity, IdentityLookup } from './identity'

export const githubPod: PodSlot = {
  ...EMPTY_POD,
  childDeny: ['subscribe', 'unsubscribe'],
  tools: (ctx) => [
    new SubscribeTool(ctx),
    new UnsubscribeTool(ctx),
    new ListSubscriptionsTool(ctx),
  ],
  hooks: ciWatchHooks,
  prompts: [new CiFeedFragment()],
  commands: podCommands,
}
