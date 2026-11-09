export const GITHUB_RUN_PROVIDER = 'github.workflow-run'

const GITHUB_HOST = 'github.com'

const RUN_NUMBER = /^#?(\d+)$/

const RUN_SHORTHAND = /^([\w.-]+)\/([\w.-]+)#(\d+)$/

const RUN_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)(?:[/?#].*)?$/

const NAME_WITH_OWNER = /^[\w.-]+\/[\w.-]+$/

const WORKFLOW_PATH = /^[\w./-]+$/

export const BAD_RUN_ID_ERROR = 'A workflow run id starts at 1'

export const NO_RUN_ERROR =
  'No workflow run exists for this checkout yet; pass #<run id>, a run URL, or <workflow>@<branch>'

export const NO_RUN_REPOSITORY_ERROR =
  'No GitHub repository to take a run from; pass owner/repo#<run id> or a run URL'

export const UNRECOGNIZED_RUN_ERROR =
  'Not a workflow run reference; pass nothing, #<run id>, owner/repo#<run id>, a github.com run URL, or <workflow>@<branch>'

export const GITHUB_EVENT_RUN_ERROR =
  'A workflow selector needs the checkout to name its repository; pass owner/repo#<run id> or a run URL'

export type RunTarget =
  | { kind: 'run'; repo: string; runId: number }
  | { kind: 'selector'; repo: string; workflow: string; branch: string }

export type RunTargetInput =
  | { kind: 'current' }
  | { kind: 'run'; repo?: string | undefined; runId: number }
  | { kind: 'selector'; workflow: string; branch?: string | undefined }
  | { kind: 'error'; error: string }

const githubRepo = (owner: string, repo: string): string =>
  `${GITHUB_HOST}/${owner}/${repo}`.toLowerCase()

export const workflowNameOf = (raw: string): string => {
  const name = raw.trim().toLowerCase()
  const last = name.split('/').pop() ?? name
  return last.includes('.') ? name : `${name}.yml`
}

export const parseRunTargetInput = (raw: string): RunTargetInput => {
  const input = raw.trim()
  if (input.length === 0) return { kind: 'current' }

  const bare = RUN_NUMBER.exec(input)
  if (bare?.[1] !== undefined) {
    const runId = Number(bare[1])
    return runId < 1 ? { kind: 'error', error: BAD_RUN_ID_ERROR } : { kind: 'run', runId }
  }

  const [, owner, repo, runId] = RUN_SHORTHAND.exec(input) ?? RUN_URL.exec(input) ?? []
  if (owner !== undefined && repo !== undefined && runId !== undefined) {
    const id = Number(runId)
    return id < 1
      ? { kind: 'error', error: BAD_RUN_ID_ERROR }
      : { kind: 'run', repo: githubRepo(owner, repo), runId: id }
  }

  const at = input.lastIndexOf('@')
  if (at > 0) {
    const branch = input.slice(at + 1).trim()
    if (branch.length === 0) return { kind: 'error', error: UNRECOGNIZED_RUN_ERROR }
    return { kind: 'selector', workflow: workflowNameOf(input.slice(0, at)), branch }
  }

  if (!NAME_WITH_OWNER.test(input) && WORKFLOW_PATH.test(input) && input.includes('.'))
    return { kind: 'selector', workflow: workflowNameOf(input) }

  return { kind: 'error', error: UNRECOGNIZED_RUN_ERROR }
}

export const runTargetOf = (value: unknown): RunTarget | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { kind, repo, runId, workflow, branch } = value as Record<string, unknown>
  if (typeof repo !== 'string' || !repo.toLowerCase().startsWith(`${GITHUB_HOST}/`)) return null
  const lowered = repo.toLowerCase()

  if (kind === 'run') {
    if (typeof runId !== 'number' || !Number.isInteger(runId) || runId < 1) return null
    return { kind: 'run', repo: lowered, runId }
  }
  if (kind !== 'selector') return null
  if (typeof workflow !== 'string' || workflow.length === 0) return null
  if (typeof branch !== 'string') return null

  return { kind: 'selector', repo: lowered, workflow, branch }
}

export const runLabelOf = (target: RunTarget): string => {
  const repo = target.repo.slice(GITHUB_HOST.length + 1)
  return target.kind === 'run'
    ? `${repo}#${target.runId}`
    : `${repo} ${target.workflow}@${target.branch}`
}

export const runTargetKey = (target: RunTarget): string =>
  target.kind === 'run'
    ? `${target.repo}#run:${target.runId}`
    : `${target.repo}#workflow:${target.workflow}@${target.branch}`

export const runSelectorOf = (target: RunTarget): string =>
  runTargetKey(target).slice(target.repo.length)

export const runTargetOfSelector = (args: { repo: string; selector: string }): RunTarget | null => {
  const run = /^#run:(\d+)$/.exec(args.selector)
  if (run?.[1] !== undefined) {
    return runTargetOf({ kind: 'run', repo: args.repo, runId: Number(run[1]) })
  }

  const selector = /^#workflow:(.+)@([^@]+)$/.exec(args.selector)
  if (selector?.[1] === undefined || selector[2] === undefined) return null

  return runTargetOf({
    kind: 'selector',
    repo: args.repo,
    workflow: selector[1],
    branch: selector[2],
  })
}

export const sameRunTarget = (a: RunTarget, b: RunTarget): boolean =>
  runTargetKey(a) === runTargetKey(b)
