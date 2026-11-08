import {
  EBeforeToolDecision,
  EStage,
  type BeforeToolOutcome,
  type Event,
  type V2Event,
} from '@dltech/atlas-core'
import type { HookChainArgs } from '@dltech/atlas-agent'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { ciWatchIntent, ECiWatch, sameTarget, targetOf } from '../core'
import { currentPullRequest } from './resolve-target'
import { githubSubscriptionsOf } from './subscribe'
import { ESubscriptionStatus } from '@dltech/atlas-core'

export const CI_WATCH_DENY_REASON =
  "Atlas is delivering this PR's events to you through a subscription and will wake you when CI reaches a verdict, a comment lands, or it merges. Do not poll or watch. Read once with `gh pr checks` (no --watch) for current state, or end your turn."

const bashInput = z.object({ command: z.string() })

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

export const ciWatchHooks = (ctx: PluginPodContext): HookChainArgs => ({
  beforeTool: [
    {
      name: 'github-block-ci-watch',
      order: { stage: EStage.Policy, nudge: 0 },
      run: async ({ call, projectDirectory }): Promise<BeforeToolOutcome> => {
        const allow: BeforeToolOutcome = { decision: EBeforeToolDecision.Allow, input: call.input }
        if (call.name !== 'bash') return allow
        const input = bashInput.safeParse(call.input)
        if (
          !input.success ||
          ciWatchIntent({ command: input.data.command }) !== ECiWatch.Watching
        ) {
          return allow
        }
        if (githubSubscriptionsOf(ctx.events()).length === 0) return allow
        const current = await currentPullRequest({ ctx, cwd: projectDirectory })
        if ('error' in current) return allow
        const held = holdsPullRequest({ events: ctx.events(), ...current.target })
        return held ? { decision: EBeforeToolDecision.Deny, reason: CI_WATCH_DENY_REASON } : allow
      },
    },
  ],
})
