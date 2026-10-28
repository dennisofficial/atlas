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
  "Atlas is delivering this PR's events to you through a subscription and will wake you when CI reaches a verdict, a comment lands, or it merges. Do not poll or watch. Read once with `gh pr checks` (no --watch) for current state, or end your turn."

const ORDER: HookOrder = { stage: EStage.Policy, nudge: 0 }

export class BlockCiWatchBeforeToolHook extends BeforeToolHook {
  readonly name = 'block-ci-watch'
  readonly order = ORDER

  private readonly pullRequests: Pick<PullRequestService, 'tracked' | 'snapshot'>
  private readonly subscribed: (args: { repo: string; number: number }) => boolean
  private readonly probe: typeof probeCheckout

  constructor(args: {
    pullRequests: Pick<PullRequestService, 'tracked' | 'snapshot'>
    subscribed: (args: { repo: string; number: number }) => boolean
    probe?: typeof probeCheckout
  }) {
    super()
    this.pullRequests = args.pullRequests
    this.subscribed = args.subscribed
    this.probe = args.probe ?? probeCheckout
  }

  private async subscribesPullRequest(directory: string): Promise<boolean> {
    const checkout = await this.probe({ directory })
    if (checkout === null) return false

    const key = checkoutKey(checkout)
    const held = this.pullRequests.tracked().some((tracked) => checkoutKey(tracked) === key)
    if (!held) return false

    const reading = this.pullRequests.snapshot({ key })
    if (reading.lookup !== EPullRequestLookup.Found) return false

    return this.subscribed({
      repo: `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`,
      number: reading.pullRequest.number,
    })
  }

  readonly run: BeforeTool = async ({ call, projectDirectory }): Promise<BeforeToolOutcome> => {
    const allow: BeforeToolOutcome = { decision: EBeforeToolDecision.Allow, input: call.input }
    if (call.name !== BASH_TOOL) return allow

    const command = commandOf(call.input)
    if (command === null) return allow
    if (ciWatchIntent({ command }) !== ECiWatch.Watching) return allow
    if (!(await this.subscribesPullRequest(projectDirectory))) return allow

    return { decision: EBeforeToolDecision.Deny, reason: CI_WATCH_DENY_REASON }
  }
}
