import {
  BeforeToolHook,
  EBeforeToolDecision,
  EStage,
  type BeforeTool,
  type BeforeToolOutcome,
  type HookOrder,
} from '@dltech/atlas-core'

import { BASH_TOOL, commandOf } from './hooks'
import { probeCheckout } from './checkout-probe'
import { checkoutKey, ciWatchIntent, ECiWatch, EPullRequestLookup } from './pure'
import type { PullRequestService } from './pull-request-service'

export const CI_WATCH_DENY_REASON =
  'Atlas tracks this PR natively and will wake you when CI reaches a verdict, a comment lands, or mergeability changes. Do not poll or watch. Read once with `gh pr checks` (no --watch) if you need current state; otherwise continue other work or end your turn.'

const ORDER: HookOrder = { stage: EStage.Policy, nudge: 0 }

/**
 * Refuses a shell that waits on CI while the session's tracked checkout has a pull request, because
 * the wake the tracking already delivers makes the wait a second, slower copy of it. The refusal is
 * the teaching moment: it names the one-shot read that stays allowed.
 *
 * The gate is the reading of the checkout the calling thread's project directory stands on, so a
 * teammate in its own worktree is gated by its own pull request rather than the main thread's.
 * Watching a PR the session does not track (no checkout there, or no PR on it) stays legitimate. A backgrounded bash is still a bash
 * call, so it is refused here before its shell is ever spawned.
 */
export class BlockCiWatchBeforeToolHook extends BeforeToolHook {
  readonly name = 'block-ci-watch'
  readonly order = ORDER

  private readonly pullRequests: PullRequestService
  private readonly probe: typeof probeCheckout

  constructor(args: { pullRequests: PullRequestService; probe?: typeof probeCheckout }) {
    super()
    this.pullRequests = args.pullRequests
    this.probe = args.probe ?? probeCheckout
  }

  private async tracksPullRequest(directory: string): Promise<boolean> {
    const checkout = await this.probe({ directory })
    if (checkout === null) return false

    const key = checkoutKey(checkout)
    const held = this.pullRequests.tracked().some((tracked) => checkoutKey(tracked) === key)
    return held && this.pullRequests.snapshot({ key }).lookup === EPullRequestLookup.Found
  }

  readonly run: BeforeTool = async ({ call, projectDirectory }): Promise<BeforeToolOutcome> => {
    const allow: BeforeToolOutcome = { decision: EBeforeToolDecision.Allow, input: call.input }
    if (call.name !== BASH_TOOL) return allow

    const command = commandOf(call.input)
    if (command === null) return allow
    if (ciWatchIntent({ command }) !== ECiWatch.Watching) return allow
    if (!(await this.tracksPullRequest(projectDirectory))) return allow

    return { decision: EBeforeToolDecision.Deny, reason: CI_WATCH_DENY_REASON }
  }
}
