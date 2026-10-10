import { z } from 'zod'

import {
  AfterShellHook,
  AfterToolHook,
  EShellStatus,
  EStage,
  type AfterShell,
  type AfterTool,
  type HookOrder,
} from '@dltech/atlas-core'

import { probeCheckout } from './checkout-probe'
import type { FamilyTracker } from './family-tracker'
import { commandEffect, ECommandEffect, type RepositoryCheckout } from './pure'
import type { PullRequestService } from './pull-request-service'

export const BASH_TOOL = 'bash'

const bashInputSchema = z.object({ command: z.string() })

export const commandOf = (input: unknown): string | null => {
  const parsed = bashInputSchema.safeParse(input)
  return parsed.success ? parsed.data.command : null
}

const ORDER: HookOrder = { stage: EStage.Observe, nudge: 0 }

/**
 * A push is waited on and a merge is not. The first opens an eager window because the answer does
 * not exist yet; the second only needs one read, because the state has already changed and the
 * settled cadence is right again the moment it is seen. Only the checkout the command ran in is
 * told: a teammate's push must not arm the main thread's window.
 */
const tell = (args: {
  pullRequests: PullRequestService
  checkout: RepositoryCheckout
  command: string
}): void => {
  const effect = commandEffect({ command: args.command })
  if (effect === ECommandEffect.StartsWork) {
    return args.pullRequests.expectChecks({ checkout: args.checkout })
  }
  if (effect === ECommandEffect.ChangesPullRequest) {
    return args.pullRequests.recheck({ checkout: args.checkout })
  }
}

/**
 * A push is the moment the pull request is about to change and the moment GitHub has least to say
 * about it, so the schedule is told to expect checks rather than left to read an empty roll-up as
 * five minutes of quiet. Nothing here is written to the log: what CI is doing is observed state, and
 * a colleague merging at three in the morning would produce the same row.
 */
export class RefreshPullRequestAfterToolHook extends AfterToolHook {
  readonly name = 'refresh-pull-request'
  readonly order = ORDER

  private readonly pullRequests: PullRequestService
  private readonly probe: typeof probeCheckout

  constructor(args: { pullRequests: PullRequestService; probe?: typeof probeCheckout }) {
    super()
    this.pullRequests = args.pullRequests
    this.probe = args.probe ?? probeCheckout
  }

  readonly run: AfterTool = async ({ call, result, projectDirectory }) => {
    if (!result.ok || call.name !== BASH_TOOL) return {}

    const command = commandOf(call.input)
    if (command === null) return {}
    if (commandEffect({ command }) === ECommandEffect.Nothing) return {}

    const checkout = await this.probe({ directory: projectDirectory })
    if (checkout === null) return {}

    tell({ pullRequests: this.pullRequests, checkout, command })
    return {}
  }
}

/**
 * A backgrounded bash returns a shell id the moment it starts, so the after-tool phase fires before
 * the push has run. This is where a backgrounded push is actually heard.
 *
 * A shell that ran to completion and failed pushed nothing, but one that was killed may well have
 * pushed long before it died, so only the first is ignored.
 */
export class RefreshPullRequestAfterShellHook extends AfterShellHook {
  readonly name = 'refresh-pull-request-after-shell'
  readonly order = ORDER

  private readonly pullRequests: PullRequestService
  private readonly tracker: FamilyTracker

  constructor(args: { pullRequests: PullRequestService; tracker: FamilyTracker }) {
    super()
    this.pullRequests = args.pullRequests
    this.tracker = args.tracker
  }

  readonly run: AfterShell = async ({ threadId, shell }) => {
    const failed = shell.status === EShellStatus.Exited && (shell.exitCode ?? 0) !== 0
    if (failed) return {}

    const checkout = this.tracker.checkoutFor({ threadId })
    if (checkout === null) return {}

    tell({ pullRequests: this.pullRequests, checkout, command: shell.command })
    return {}
  }
}
