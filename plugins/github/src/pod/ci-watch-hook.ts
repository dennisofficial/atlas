import {
  EBeforeToolDecision,
  EStage,
  ESubscriptionStatus,
  type BeforeToolOutcome,
  type Event,
  type V2Event,
} from '@dltech/atlas-core'
import type { HookChainArgs } from '@dltech/atlas-agent'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import {
  ciWatchIntent,
  ECiWatch,
  GITHUB_RUN_PROVIDER,
  runTargetOf,
  sameTarget,
  targetOf,
} from '../core'
import { currentPullRequest, readCheckout } from './resolve-target'
import { githubSubscriptionsOf } from './subscribe'

export const CI_WATCH_DENY_REASON =
  "Atlas is delivering this PR's events to you through a subscription and will wake you when CI reaches a verdict, a comment lands, or it merges. Do not poll or watch. Read once with `gh pr checks` (no --watch) for current state, or end your turn."

export const PULL_REQUEST_SUBSCRIBE_REASON =
  "Atlas delivers pull request events through a subscription: call `subscribe` with provider `github.pull-request` (blank for this checkout's pull request), then end your turn. One-shot reads such as `gh pr checks` stay available."

export const WORKFLOW_RUN_WAKE_REASON =
  'Atlas is already delivering this workflow run to you and will wake you when it finishes. End your turn; read once with `gh run view <id>` (no `--watch`) if you need the current state now.'

export const WORKFLOW_RUN_SUBSCRIBE_REASON =
  "Do not watch runs from bash: call `subscribe` with provider `github.workflow-run` (blank for this push's run, or `<workflow>@<branch>`), then end your turn. One-shot reads such as `gh run view <id>` stay available."

const bashInput = z.object({ command: z.string() })

type Watching = { ctx: PluginPodContext; cwd?: string | undefined }

const holdsPullRequest = (args: {
  events: readonly (Event | V2Event)[]
  repo: string
  number: number
}): boolean =>
  githubSubscriptionsOf(args.events).some((row) => {
    const target = targetOf(row.target)
    return (
      row.status === ESubscriptionStatus.Active &&
      target !== null &&
      sameTarget(target, { repo: args.repo, number: args.number })
    )
  })

const holdsWorkflowRun = (args: {
  events: readonly (Event | V2Event)[]
  repo: string
  branch: string
}): boolean =>
  githubSubscriptionsOf(args.events).some((row) => {
    if (row.provider !== GITHUB_RUN_PROVIDER || row.status !== ESubscriptionStatus.Active)
      return false
    const target = runTargetOf(row.target)
    if (target === null || target.repo !== args.repo) return false
    return target.kind === 'run' || target.branch === args.branch
  })

const pullRequestReason = async (args: Watching): Promise<string | null> => {
  const current = await currentPullRequest({ ctx: args.ctx, cwd: args.cwd })
  if ('error' in current) return null
  return holdsPullRequest({ events: args.ctx.events(), ...current.target })
    ? CI_WATCH_DENY_REASON
    : PULL_REQUEST_SUBSCRIBE_REASON
}

const workflowRunReason = async (args: Watching): Promise<string> => {
  const checkout = await readCheckout({ ctx: args.ctx, cwd: args.cwd })
  if (checkout === null) return WORKFLOW_RUN_SUBSCRIBE_REASON
  return holdsWorkflowRun({ events: args.ctx.events(), ...checkout })
    ? WORKFLOW_RUN_WAKE_REASON
    : WORKFLOW_RUN_SUBSCRIBE_REASON
}

export const ciWatchHooks = (ctx: PluginPodContext): HookChainArgs => ({
  beforeTool: [
    {
      name: 'github-block-ci-watch',
      order: { stage: EStage.Policy, nudge: 0 },
      run: async ({ call, projectDirectory }): Promise<BeforeToolOutcome> => {
        const allow: BeforeToolOutcome = { decision: EBeforeToolDecision.Allow, input: call.input }
        if (call.name !== 'bash') return allow
        const input = bashInput.safeParse(call.input)
        if (!input.success) return allow
        const intent = ciWatchIntent({ command: input.data.command })
        if (intent.kind === ECiWatch.Reading) return allow
        const watching = { ctx, cwd: projectDirectory }
        const reason =
          intent.of === 'workflow-run'
            ? await workflowRunReason(watching)
            : await pullRequestReason(watching)
        return reason === null ? allow : { decision: EBeforeToolDecision.Deny, reason }
      },
    },
  ],
})
