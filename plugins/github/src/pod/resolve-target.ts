import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  GITHUB_EVENT_RUN_ERROR,
  labelOf,
  NO_PULL_REQUEST_ERROR,
  NO_REPOSITORY_ERROR,
  NO_RUN_ERROR,
  NO_RUN_REPOSITORY_ERROR,
  parseRunTargetInput,
  parseTargetInput,
  runLabelOf,
  targetOfRepo,
  UNRECOGNIZED_ERROR,
  UNRECOGNIZED_RUN_ERROR,
  type PullRequestTarget,
  type RunTarget,
} from '../core'
import { runGh } from './gh'

type GhCtx = Pick<PluginPodContext, 'call'>

export type ResolvedTarget = { target: PullRequestTarget; label: string }
export type ResolveOutcome = ResolvedTarget | { error: string }
export type ResolvedRun = { target: RunTarget; label: string }
export type RunResolveOutcome = ResolvedRun | { error: string }
export type GithubCheckout = { repo: string; branch: string }

const GITHUB_HOST = 'github.com'

const NAME_WITH_OWNER = /^[\w.-]+\/[\w.-]+$/

const NAME_WITH_OWNER_ARGV: readonly string[] = [
  'repo',
  'view',
  '--json',
  'nameWithOwner',
  '-q',
  '.nameWithOwner',
]

const HEAD_BRANCH_ARGV: readonly string[] = [
  'pr',
  'view',
  '--json',
  'headRefName',
  '-q',
  '.headRefName',
]

const DEFAULT_BRANCH_ARGV: readonly string[] = [
  'repo',
  'view',
  '--json',
  'defaultBranchRef',
  '-q',
  '.defaultBranchRef.name',
]

const LATEST_RUN_ARGV: readonly string[] = [
  'run',
  'list',
  '--limit',
  '1',
  '--json',
  'databaseId,name',
]

const resolved = (target: PullRequestTarget): ResolvedTarget => ({ target, label: labelOf(target) })

const resolvedRun = (target: RunTarget): ResolvedRun => ({ target, label: runLabelOf(target) })

const latestRunOf = (text: string): number | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const first: unknown = Array.isArray(parsed) ? parsed[0] : null
  if (typeof first !== 'object' || first === null) return null
  const { databaseId } = first as { databaseId?: unknown }
  if (typeof databaseId !== 'number' || !Number.isInteger(databaseId)) return null
  return databaseId < 1 ? null : databaseId
}

const checkoutRepo = async (args: {
  ctx: GhCtx
  cwd?: string | undefined
}): Promise<string | null> => {
  const view = await runGh({ ctx: args.ctx, cwd: args.cwd, argv: NAME_WITH_OWNER_ARGV })
  const name = view.ok ? view.text.trim() : ''
  return NAME_WITH_OWNER.test(name) ? `${GITHUB_HOST}/${name}`.toLowerCase() : null
}

const checkoutBranch = async (args: { ctx: GhCtx; cwd?: string | undefined }): Promise<string> => {
  const head = await runGh({ ctx: args.ctx, cwd: args.cwd, argv: HEAD_BRANCH_ARGV })
  const name = head.ok ? head.text.trim() : ''
  if (name.length > 0) return name
  const fallback = await runGh({ ctx: args.ctx, cwd: args.cwd, argv: DEFAULT_BRANCH_ARGV })
  return fallback.ok ? fallback.text.trim() : ''
}

export const readCheckout = async (args: {
  ctx: GhCtx
  cwd?: string | undefined
}): Promise<GithubCheckout | null> => {
  const repo = await checkoutRepo(args)
  if (repo === null) return null
  return { repo, branch: await checkoutBranch(args) }
}

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

const currentRun = async (args: {
  ctx: GhCtx
  cwd?: string | undefined
}): Promise<RunResolveOutcome> => {
  const repo = await checkoutRepo(args)
  if (repo === null) return { error: NO_RUN_REPOSITORY_ERROR }
  const listed = await runGh({ ctx: args.ctx, cwd: args.cwd, argv: LATEST_RUN_ARGV })
  const runId = listed.ok ? latestRunOf(listed.text) : null
  return runId === null ? { error: NO_RUN_ERROR } : resolvedRun({ kind: 'run', repo, runId })
}

const runInCheckout = async (args: {
  ctx: GhCtx
  cwd?: string | undefined
  runId: number
}): Promise<RunResolveOutcome> => {
  const repo = await checkoutRepo(args)
  return repo === null
    ? { error: NO_RUN_REPOSITORY_ERROR }
    : resolvedRun({ kind: 'run', repo, runId: args.runId })
}

const selectorInCheckout = async (args: {
  ctx: GhCtx
  cwd?: string | undefined
  workflow: string
  branch?: string | undefined
}): Promise<RunResolveOutcome> => {
  const repo = await checkoutRepo(args)
  if (repo === null) return { error: GITHUB_EVENT_RUN_ERROR }
  const branch = args.branch ?? (await checkoutBranch(args))
  if (branch.length === 0) return { error: GITHUB_EVENT_RUN_ERROR }
  return resolvedRun({ kind: 'selector', repo, workflow: args.workflow, branch })
}

export const resolveRunTarget = async (args: {
  ctx: GhCtx
  input: string
  cwd?: string | undefined
  explicitOnly?: boolean | undefined
}): Promise<RunResolveOutcome> => {
  const parsed = parseRunTargetInput(args.input)
  if (parsed.kind === 'error') return { error: parsed.error }
  if (parsed.kind === 'run') {
    if (parsed.repo !== undefined) {
      return resolvedRun({ kind: 'run', repo: parsed.repo, runId: parsed.runId })
    }
    return args.explicitOnly === true
      ? { error: UNRECOGNIZED_RUN_ERROR }
      : runInCheckout({ ctx: args.ctx, cwd: args.cwd, runId: parsed.runId })
  }
  if (parsed.kind === 'selector') {
    return args.explicitOnly === true
      ? { error: UNRECOGNIZED_RUN_ERROR }
      : selectorInCheckout({
          ctx: args.ctx,
          cwd: args.cwd,
          workflow: parsed.workflow,
          branch: parsed.branch,
        })
  }
  return args.explicitOnly === true
    ? { error: UNRECOGNIZED_RUN_ERROR }
    : currentRun({ ctx: args.ctx, cwd: args.cwd })
}
