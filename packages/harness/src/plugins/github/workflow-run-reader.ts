import { runGit } from '../../workspace/run-git'
import { GH_TIMEOUT_MS } from './gh-pull-requests'
import { spawnCommand, type CommandRun, type CommandRunner } from './run-command'

export const RUN_COMPLETED = 'completed'

const RUN_SUCCESS = 'success'

const JOB_FAILURE = 'failure'

const FAILED_JOB_LIMIT = 10

const JOB_PAGE_SIZE = 100

const SELECTOR_PAGE_SIZE = 10

const GITHUB_PREFIX = 'github.com/'

export type WorkflowRunReading = {
  runId: number
  workflow: string
  branch: string
  headSha: string
  url: string
  status: string
  conclusion: string
  failedJobs?: readonly string[] | undefined
}

export type WorkflowRunReader = {
  pin: (args: { repo: string; runId: number }) => Promise<WorkflowRunReading | null>
  latest: (args: {
    repo: string
    directory: string
    branch: string
  }) => Promise<WorkflowRunReading | null>
  selector: (args: {
    repo: string
    workflow: string
    branch: string
  }) => Promise<readonly WorkflowRunReading[]>
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const textIn = (record: Record<string, unknown>, key: string): string => {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const rowsIn = (value: unknown, key: string): readonly unknown[] => {
  const rows = recordOf(value)?.[key]
  return Array.isArray(rows) ? rows : []
}

export const readingOf = (value: unknown): WorkflowRunReading | null => {
  const row = recordOf(value)
  if (row === null) return null

  const runId = row['id']
  const url = row['html_url']
  const status = row['status']
  if (typeof runId !== 'number' || !Number.isInteger(runId) || runId < 1) return null
  if (typeof url !== 'string' || url.length === 0) return null
  if (typeof status !== 'string' || status.length === 0) return null

  const named = textIn(row, 'name')
  return {
    runId,
    workflow: named.length > 0 ? named : textIn(row, 'path'),
    branch: textIn(row, 'head_branch'),
    headSha: textIn(row, 'head_sha'),
    url,
    status,
    conclusion: textIn(row, 'conclusion'),
  }
}

const failedNamesOf = (value: unknown): readonly string[] =>
  rowsIn(value, 'jobs')
    .map(recordOf)
    .filter((row): row is Record<string, unknown> => row !== null)
    .filter((row) => row['conclusion'] === JOB_FAILURE)
    .map((row) => textIn(row, 'name'))
    .filter((name) => name.length > 0)
    .slice(0, FAILED_JOB_LIMIT)

const slugOf = (repo: string): string =>
  repo.toLowerCase().startsWith(GITHUB_PREFIX)
    ? repo.slice(GITHUB_PREFIX.length)
    : repo.toLowerCase()

export function createGhWorkflowRunReader(args?: {
  run?: CommandRunner
  cwd?: string
}): WorkflowRunReader {
  const run = args?.run ?? spawnCommand
  const directory = (): string => args?.cwd ?? process.cwd()

  const ask = async (request: { path: string; cwd: string }): Promise<unknown> => {
    const answer: CommandRun = await run({
      argv: ['gh', 'api', request.path],
      cwd: request.cwd,
      timeoutMs: GH_TIMEOUT_MS,
    })
    if (answer.failure !== null || answer.code !== 0) return null

    return jsonOf(answer.stdout)
  }

  const runsAt = async (request: { path: string }): Promise<readonly WorkflowRunReading[]> => {
    const body = await ask({ path: request.path, cwd: directory() })
    return rowsIn(body, 'workflow_runs').flatMap((row): WorkflowRunReading[] => {
      const reading = readingOf(row)
      return reading === null ? [] : [reading]
    })
  }

  const failedJobsOf = async (request: {
    repo: string
    runId: number
  }): Promise<readonly string[]> => {
    const body = await ask({
      path: `repos/${slugOf(request.repo)}/actions/runs/${request.runId}/jobs?per_page=${JOB_PAGE_SIZE}`,
      cwd: directory(),
    })

    return failedNamesOf(body)
  }

  return {
    pin: async ({ repo, runId }) => {
      const body = await ask({
        path: `repos/${slugOf(repo)}/actions/runs/${runId}`,
        cwd: directory(),
      })
      const reading = readingOf(body)
      if (reading === null) return null
      if (reading.status !== RUN_COMPLETED || reading.conclusion === RUN_SUCCESS) return reading

      const failedJobs = await failedJobsOf({ repo, runId })
      return failedJobs.length === 0 ? reading : { ...reading, failedJobs }
    },
    latest: async ({ repo, directory: checkoutDirectory, branch }) => {
      const head = await runGit({ args: ['rev-parse', 'HEAD'], cwd: checkoutDirectory })
      const headSha = head.ok ? head.stdout.trim() : ''
      const query = [
        ...(headSha.length === 0 ? [] : [`head_sha=${headSha}`]),
        `branch=${encodeURIComponent(branch)}`,
        'per_page=1',
      ].join('&')

      const readings = await runsAt({ path: `repos/${slugOf(repo)}/actions/runs?${query}` })
      return readings[0] ?? null
    },
    selector: async ({ repo, workflow, branch }) =>
      runsAt({
        path: `repos/${slugOf(repo)}/actions/runs?workflow=${encodeURIComponent(workflow)}&branch=${encodeURIComponent(branch)}&per_page=${SELECTOR_PAGE_SIZE}`,
      }),
  }
}
