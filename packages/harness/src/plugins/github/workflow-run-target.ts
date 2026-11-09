import type { ResolvedTarget } from '../../subscriptions/provider'
import { EForge, type RepositoryCheckout } from './pure'

export enum EWorkflowRunTargetKind {
  Run = 'run',
  Selector = 'selector',
}

export type WorkflowRunTarget =
  | { kind: EWorkflowRunTargetKind.Run; repo: string; runId: number }
  | {
      kind: EWorkflowRunTargetKind.Selector
      repo: string
      workflow: string
      branch: string
    }

export type FoundRun = { runId: number; workflow: string }

const GITHUB_HOST = 'github.com'

const GITHUB_PREFIX = `${GITHUB_HOST}/`

const RUN_NUMBER_FORM = /^#?(\d+)$/
const RUN_SHORTHAND_FORM = /^([\w.-]+)\/([\w.-]+)#(\d+)$/
const RUN_URL_FORM =
  /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)(?:[/?#].*)?$/
const SELECTOR_FORM = /^([\w./-]+)@([\w./-]+)$/
const WORKFLOW_FILE_FORM = /^[\w./-]+\.[yY][aA]?[mM][lL]$/
const WORKFLOW_EXTENSION = '.yml'
const HEAD_SEPARATOR = '@'

export const NO_CHECKOUT_ERROR =
  'This thread has no checkout to take a repository from; pass owner/repo#<run id>, a run URL, or <workflow>@<branch>'
export const NOT_GITHUB_ERROR =
  "This thread's checkout is not on github.com; pass owner/repo#<run id> or a github.com run URL"
export const NO_RUN_ERROR =
  'This checkout has no workflow run for its HEAD yet, and GitHub registers one seconds after a push; pass #<run id>, owner/repo#<run id>, a run URL, or <workflow>@<branch>'
export const BAD_RUN_ID_ERROR = 'A workflow run id starts at 1'
export const UNRECOGNIZED_ERROR =
  'Not a workflow run reference; pass nothing, #<run id>, owner/repo#<run id>, a github.com run URL, or <workflow>@<branch>'

export const labelOf = (args: { target: WorkflowRunTarget; workflow?: string }): string => {
  const slug = args.target.repo.slice(GITHUB_PREFIX.length).toLowerCase()
  if (args.target.kind === EWorkflowRunTargetKind.Selector) {
    return `${slug} ${args.target.workflow}@${args.target.branch}`
  }

  return args.workflow === undefined
    ? `${slug}#${args.target.runId}`
    : `${slug}#${args.target.runId} \u00b7 ${args.workflow}`
}

export const targetKey = (target: WorkflowRunTarget): string =>
  target.kind === EWorkflowRunTargetKind.Selector
    ? `${target.repo.toLowerCase()}#workflow:${target.workflow}@${target.branch}`
    : `${target.repo.toLowerCase()}#run:${target.runId}`

export const workflowRunRepoOf = (checkout: RepositoryCheckout | null): string | null => {
  if (checkout === null) return null
  if (checkout.forge !== EForge.GitHub || checkout.remote.host !== GITHUB_HOST) return null

  return `${GITHUB_HOST}/${checkout.remote.owner}/${checkout.remote.repo}`.toLowerCase()
}

export function targetOf(value: unknown): WorkflowRunTarget | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const repo = record['repo']
  if (typeof repo !== 'string' || !repo.toLowerCase().startsWith(GITHUB_PREFIX)) return null

  const lowered = repo.toLowerCase()
  if (record['kind'] === EWorkflowRunTargetKind.Run) {
    const runId = record['runId']
    if (typeof runId !== 'number' || !Number.isInteger(runId) || runId < 1) return null

    return { kind: EWorkflowRunTargetKind.Run, repo: lowered, runId }
  }
  if (record['kind'] !== EWorkflowRunTargetKind.Selector) return null

  const workflow = record['workflow']
  const branch = record['branch']
  if (typeof workflow !== 'string' || workflow.length === 0) return null
  if (typeof branch !== 'string' || branch.length === 0) return null

  return { kind: EWorkflowRunTargetKind.Selector, repo: lowered, workflow, branch }
}

const resolved = (args: { target: WorkflowRunTarget; workflow?: string }): ResolvedTarget => ({
  target: args.target,
  label: labelOf(args),
})

const runOf = (args: { repo: string; runId: number; workflow?: string }): ResolvedTarget =>
  resolved({
    target: { kind: EWorkflowRunTargetKind.Run, repo: args.repo.toLowerCase(), runId: args.runId },
    ...(args.workflow === undefined ? {} : { workflow: args.workflow }),
  })

const selectorOf = (args: { repo: string; workflow: string; branch: string }): ResolvedTarget =>
  resolved({
    target: {
      kind: EWorkflowRunTargetKind.Selector,
      repo: args.repo.toLowerCase(),
      workflow: args.workflow,
      branch: args.branch,
    },
  })

export const workflowFileOf = (name: string): string => {
  const lowered = name.trim().toLowerCase()
  const segmentation = lowered.split('/')
  const last = segmentation[segmentation.length - 1] ?? ''

  return last.includes('.') ? lowered : `${lowered}${WORKFLOW_EXTENSION}`
}

const locatedRepo = (checkout: RepositoryCheckout | null): string | { error: string } => {
  if (checkout === null) return { error: NO_CHECKOUT_ERROR }

  const repo = workflowRunRepoOf(checkout)
  return repo === null ? { error: NOT_GITHUB_ERROR } : repo
}

const blankTarget = (args: {
  checkout: RepositoryCheckout | null
  foundRun: FoundRun | null
}): ResolvedTarget | { error: string } => {
  const repo = locatedRepo(args.checkout)
  if (typeof repo !== 'string') return repo
  if (args.foundRun === null) return { error: NO_RUN_ERROR }

  return runOf({ repo, runId: args.foundRun.runId, workflow: args.foundRun.workflow })
}

const checkoutRunTarget = (args: {
  checkout: RepositoryCheckout | null
  number: string
}): ResolvedTarget | { error: string } => {
  const runId = Number(args.number)
  if (runId < 1) return { error: BAD_RUN_ID_ERROR }

  const repo = locatedRepo(args.checkout)
  if (typeof repo !== 'string') return repo

  return runOf({ repo, runId })
}

const selectorTarget = (args: {
  checkout: RepositoryCheckout | null
  workflow: string
  branch?: string | undefined
}): ResolvedTarget | { error: string } => {
  const repo = locatedRepo(args.checkout)
  if (typeof repo !== 'string') return repo

  const branch = args.branch ?? args.checkout?.branch ?? ''
  if (branch.length === 0) return { error: NO_CHECKOUT_ERROR }

  return selectorOf({ repo, workflow: workflowFileOf(args.workflow), branch })
}

const explicitRunTarget = (args: {
  owner: string
  repo: string
  number: string
}): ResolvedTarget | { error: string } => {
  const runId = Number(args.number)
  if (runId < 1) return { error: BAD_RUN_ID_ERROR }

  return runOf({ repo: `${GITHUB_HOST}/${args.owner}/${args.repo}`, runId })
}

export function resolveWorkflowRunTarget(args: {
  input: string
  checkout: RepositoryCheckout | null
  foundRun: FoundRun | null
}): ResolvedTarget | { error: string } {
  const input = args.input.trim()
  if (input.length === 0) return blankTarget({ checkout: args.checkout, foundRun: args.foundRun })

  const bare = RUN_NUMBER_FORM.exec(input)
  if (bare?.[1] !== undefined)
    return checkoutRunTarget({ checkout: args.checkout, number: bare[1] })

  const shorthand = RUN_SHORTHAND_FORM.exec(input) ?? RUN_URL_FORM.exec(input)
  if (shorthand !== null) {
    const [, owner, repo, number] = shorthand
    if (owner === undefined || repo === undefined || number === undefined) {
      return { error: UNRECOGNIZED_ERROR }
    }

    return explicitRunTarget({ owner, repo, number })
  }

  const selector = SELECTOR_FORM.exec(input)
  if (selector?.[1] !== undefined && selector[2] !== undefined) {
    const separator = input.lastIndexOf(HEAD_SEPARATOR)
    const branch = input.slice(separator + 1)
    if (branch.length === 0) return { error: UNRECOGNIZED_ERROR }

    return selectorTarget({ checkout: args.checkout, workflow: selector[1], branch })
  }

  if (WORKFLOW_FILE_FORM.test(input))
    return selectorTarget({ checkout: args.checkout, workflow: input })

  return { error: UNRECOGNIZED_ERROR }
}
