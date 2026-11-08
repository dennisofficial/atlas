import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  labelOf,
  NO_PULL_REQUEST_ERROR,
  NO_REPOSITORY_ERROR,
  parseTargetInput,
  targetOfRepo,
  UNRECOGNIZED_ERROR,
  type PullRequestTarget,
} from '../core'
import { runGh } from './gh'

export type ResolvedTarget = { target: PullRequestTarget; label: string }
export type ResolveOutcome = ResolvedTarget | { error: string }

const resolved = (target: PullRequestTarget): ResolvedTarget => ({ target, label: labelOf(target) })

export const currentPullRequest = async (args: {
  ctx: Pick<PluginPodContext, 'call'>
  cwd?: string | undefined
}): Promise<ResolveOutcome> => {
  const view = await runGh({ ...args, argv: ['pr', 'view', '--json', 'url', '-q', '.url'] })
  if (!view.ok) return { error: NO_PULL_REQUEST_ERROR }
  const parsed = parseTargetInput(view.text)
  return parsed.kind === 'explicit' ? resolved(parsed.target) : { error: NO_PULL_REQUEST_ERROR }
}

const numberInCheckout = async (args: {
  ctx: Pick<PluginPodContext, 'call'>
  cwd?: string | undefined
  number: number
}): Promise<ResolveOutcome> => {
  const repo = await runGh({
    ctx: args.ctx,
    cwd: args.cwd,
    argv: ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
  })
  if (!repo.ok) return { error: NO_REPOSITORY_ERROR }
  const target = targetOfRepo({ nameWithOwner: repo.text, number: args.number })
  return target === undefined ? { error: NO_REPOSITORY_ERROR } : resolved(target)
}

export const resolveTarget = async (args: {
  ctx: Pick<PluginPodContext, 'call'>
  input: string
  cwd?: string | undefined
  explicitOnly?: boolean | undefined
}): Promise<ResolveOutcome> => {
  const parsed = parseTargetInput(args.input)
  if (parsed.kind === 'error') return { error: parsed.error }
  if (parsed.kind === 'explicit') return resolved(parsed.target)
  if (args.explicitOnly === true) return { error: UNRECOGNIZED_ERROR }
  if (parsed.kind === 'current') return currentPullRequest(args)
  return numberInCheckout({ ...args, number: parsed.number })
}
