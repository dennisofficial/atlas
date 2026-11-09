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
import {
  checkoutKey,
  ciWatchIntent,
  ECiWatch,
  EPullRequestLookup,
  type ECiWatchOf,
  type RepositoryCheckout,
} from './pure'
import type { PullRequestService } from './pull-request-service'

export const CI_WATCH_DENY_REASON =
  "Atlas is delivering this PR's events to you through a subscription and will wake you when CI reaches a verdict, a comment lands, or it merges. Do not poll or watch. Read once with `gh pr checks` (no --watch) for current state, or end your turn."

export const PULL_REQUEST_SUBSCRIBE_REASON =
  "Atlas delivers pull request events through a subscription: call `subscribe` with provider `github.pull-request` (blank for this checkout's pull request), then end your turn. One-shot reads such as `gh pr checks` stay available."

export const WORKFLOW_RUN_WAKE_REASON =
  'Atlas is already delivering this workflow run to you and will wake you when it finishes. End your turn; read once with `gh run view <id>` (no `--watch`) if you need the current state now.'

export const WORKFLOW_RUN_SUBSCRIBE_REASON =
  "Do not watch runs from bash: call `subscribe` with provider `github.workflow-run` (blank for this push's run, or `<workflow>@<branch>`), then end your turn. One-shot reads such as `gh run view <id>` stay available."

const ORDER: HookOrder = { stage: EStage.Policy, nudge: 0 }

const repositoryOf = (checkout: RepositoryCheckout): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`

export class BlockCiWatchBeforeToolHook extends BeforeToolHook {
  readonly name = 'block-ci-watch'
  readonly order = ORDER

  private readonly pullRequests: Pick<PullRequestService, 'tracked' | 'snapshot'>
  private readonly subscribed: (args: { repo: string; number: number }) => boolean
  private readonly subscribedRun: (args: { repo: string; branch: string }) => boolean
  private readonly probe: typeof probeCheckout

  constructor(args: {
    pullRequests: Pick<PullRequestService, 'tracked' | 'snapshot'>
    subscribed: (args: { repo: string; number: number }) => boolean
    subscribedRun: (args: { repo: string; branch: string }) => boolean
    probe?: typeof probeCheckout
  }) {
    super()
    this.pullRequests = args.pullRequests
    this.subscribed = args.subscribed
    this.subscribedRun = args.subscribedRun
    this.probe = args.probe ?? probeCheckout
  }

  private pullRequestHeld(checkout: RepositoryCheckout): boolean {
    const key = checkoutKey(checkout)
    const held = this.pullRequests.tracked().some((tracked) => checkoutKey(tracked) === key)
    if (!held) return false

    const reading = this.pullRequests.snapshot({ key })
    if (reading.lookup !== EPullRequestLookup.Found) return false

    return this.subscribed({ repo: repositoryOf(checkout), number: reading.pullRequest.number })
  }

  private denyReason(args: { of: ECiWatchOf; checkout: RepositoryCheckout }): string {
    if (args.of === 'pull-request') {
      return this.pullRequestHeld(args.checkout)
        ? CI_WATCH_DENY_REASON
        : PULL_REQUEST_SUBSCRIBE_REASON
    }

    const subscribed = this.subscribedRun({
      repo: repositoryOf(args.checkout),
      branch: args.checkout.branch,
    })

    return subscribed ? WORKFLOW_RUN_WAKE_REASON : WORKFLOW_RUN_SUBSCRIBE_REASON
  }

  readonly run: BeforeTool = async ({ call, projectDirectory }): Promise<BeforeToolOutcome> => {
    const allow: BeforeToolOutcome = { decision: EBeforeToolDecision.Allow, input: call.input }
    if (call.name !== BASH_TOOL) return allow

    const command = commandOf(call.input)
    if (command === null) return allow

    const intent = ciWatchIntent({ command })
    if (intent.kind === ECiWatch.Reading) return allow

    const checkout = await this.probe({ directory: projectDirectory })
    if (checkout === null) return allow

    return {
      decision: EBeforeToolDecision.Deny,
      reason: this.denyReason({ of: intent.of, checkout }),
    }
  }
}
