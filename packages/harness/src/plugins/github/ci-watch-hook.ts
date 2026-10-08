import {
  BeforeToolHook,
  EBeforeToolDecision,
  EStage,
  type BeforeTool,
  type BeforeToolOutcome,
  type HookOrder,
} from '@dltech/atlas-core'

import { BASH_TOOL, commandOf } from './hooks'
import { ciWatchIntent, ECiWatch, EPullRequestLookup } from './pure'
import type { PullRequestService } from './pull-request-service'

export const CI_WATCH_DENY_REASON =
  'Atlas tracks this PR natively and will wake you when CI reaches a verdict, a comment lands, or mergeability changes. Do not poll or watch. Read once with `gh pr checks` (no --watch) if you need current state; otherwise continue other work or end your turn.'

const ORDER: HookOrder = { stage: EStage.Policy, nudge: 0 }

/**
 * Refuses a shell that waits on CI while the session's tracked checkout has a pull request, because
 * the wake the tracking already delivers makes the wait a second, slower copy of it. The refusal is
 * the teaching moment: it names the one-shot read that stays allowed.
 *
 * The gate is the tracked reading alone, not a comparison of the call's directory with the tracked
 * checkout: the hook is handed the session's project directory rather than the shell's cwd, and a
 * session follows its worktree, so the two legitimately differ. Watching a PR the session does not
 * track (no tracked checkout, or no PR on it) stays legitimate. A backgrounded bash is still a bash
 * call, so it is refused here before its shell is ever spawned.
 */
export class BlockCiWatchBeforeToolHook extends BeforeToolHook {
  readonly name = 'block-ci-watch'
  readonly order = ORDER

  private readonly pullRequests: PullRequestService

  constructor(args: { pullRequests: PullRequestService }) {
    super()
    this.pullRequests = args.pullRequests
  }

  private tracksPullRequest(): boolean {
    const tracked = this.pullRequests.current()
    return tracked !== null && tracked.reading.lookup === EPullRequestLookup.Found
  }

  readonly run: BeforeTool = async ({ call }): Promise<BeforeToolOutcome> => {
    const allow: BeforeToolOutcome = { decision: EBeforeToolDecision.Allow, input: call.input }
    if (call.name !== BASH_TOOL) return allow

    const command = commandOf(call.input)
    if (command === null) return allow
    if (ciWatchIntent({ command }) !== ECiWatch.Watching) return allow
    if (!this.tracksPullRequest()) return allow

    return { decision: EBeforeToolDecision.Deny, reason: CI_WATCH_DENY_REASON }
  }
}
