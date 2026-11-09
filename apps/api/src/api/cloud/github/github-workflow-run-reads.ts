import { Injectable } from '@nestjs/common'
import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import { GithubUserReadFailed } from './github-user-reads'

const GITHUB_API = 'https://api.github.com'
const DETAIL_CAP = 300
const GITHUB_REQUEST_TIMEOUT_MS = 8_000

export type WorkflowRunSnapshot = {
  id: string
  status: string
  conclusion: string | null
  name: string
  headBranch: string
  url: string
  failedJobs: readonly string[]
}

export type WorkflowRunRead =
  | { outcome: 'found'; run: WorkflowRunSnapshot }
  | { outcome: 'not-found' }
  | { outcome: 'unavailable' }

const FAILED_JOB_LIMIT = 10

const CONCLUSIONS_WITHOUT_LOGS = new Set(['cancelled', 'startup_failure', 'skipped'])

interface RestJob {
  name?: string | null
  conclusion?: string | null
}

const failedJobNamesOf = (jobs: readonly RestJob[]): readonly string[] =>
  jobs
    .filter((job) => job.conclusion === 'failure' && typeof job.name === 'string')
    .slice(0, FAILED_JOB_LIMIT)
    .map((job) => job.name ?? '')

interface RestWorkflowRun {
  id: number
  name?: string | null
  head_branch?: string | null
  html_url?: string | null
  status?: string | null
  conclusion?: string | null
}

const workflowRunOf = (run: RestWorkflowRun): WorkflowRunSnapshot => ({
  id: String(run.id),
  status: run.status ?? '',
  conclusion: run.conclusion ?? null,
  name: run.name ?? '',
  headBranch: run.head_branch ?? '',
  url: run.html_url ?? '',
  failedJobs: [],
})

/**
 * Workflow runs as the subscribing user: the pinned form of a run subscription reads one run id,
 * the selector form reads the newest run of a workflow on a branch. A run that is gone or that
 * github will not answer for is a result, not an exception — the sweeper leaves the row to its TTL.
 */
@Injectable()
export class GithubWorkflowRunReads {
  private readonly baseUrl = process.env.GITHUB_API_URL ?? GITHUB_API

  async readWorkflowRun(args: {
    source: EGithubCallSource
    token: string
    owner: string
    repo: string
    runId: number
  }): Promise<WorkflowRunRead> {
    return this.readRun({
      source: args.source,
      token: args.token,
      repoPath: `/repos/${args.owner}/${args.repo}`,
      path: `/repos/${args.owner}/${args.repo}/actions/runs/${args.runId}`,
    })
  }

  async latestWorkflowRun(args: {
    source: EGithubCallSource
    token: string
    owner: string
    repo: string
    workflow: string
    branch: string
  }): Promise<WorkflowRunRead> {
    const workflow = encodeURIComponent(args.workflow)
    const branch = encodeURIComponent(args.branch)
    return this.readRun({
      source: args.source,
      token: args.token,
      repoPath: `/repos/${args.owner}/${args.repo}`,
      path: `/repos/${args.owner}/${args.repo}/actions/runs?workflow_id=${workflow}&branch=${branch}&per_page=1`,
      newest: true,
    })
  }

  private async readRun(args: {
    source: EGithubCallSource
    token: string
    repoPath: string
    path: string
    newest?: boolean
  }): Promise<WorkflowRunRead> {
    let body: RestWorkflowRun | { workflow_runs?: RestWorkflowRun[] }
    try {
      body = await this.get<RestWorkflowRun | { workflow_runs?: RestWorkflowRun[] }>(args)
    } catch (failure) {
      if (!(failure instanceof GithubUserReadFailed)) throw failure
      return failure.status === 404 ? { outcome: 'not-found' } : { outcome: 'unavailable' }
    }
    const run =
      args.newest === true
        ? (body as { workflow_runs?: RestWorkflowRun[] }).workflow_runs?.[0]
        : body
    if (run === undefined || !('id' in run)) return { outcome: 'not-found' }
    const snapshot = workflowRunOf(run)
    if (!this.failedRun(snapshot)) return { outcome: 'found', run: snapshot }

    const failedJobs = await this.readFailedJobs({
      source: args.source,
      token: args.token,
      repoPath: args.repoPath,
      runId: snapshot.id,
    }).catch(() => [])
    return { outcome: 'found', run: { ...snapshot, failedJobs } }
  }

  private failedRun(run: WorkflowRunSnapshot): boolean {
    if (run.status !== 'completed' || run.conclusion === null) return false
    if (run.conclusion === 'success') return false

    return !CONCLUSIONS_WITHOUT_LOGS.has(run.conclusion)
  }

  private async readFailedJobs(args: {
    source: EGithubCallSource
    token: string
    repoPath: string
    runId: string
  }): Promise<readonly string[]> {
    const body = await this.get<{ jobs?: RestJob[] }>({
      source: args.source,
      token: args.token,
      path: `${args.repoPath}/actions/runs/${args.runId}/jobs?per_page=100`,
    })
    return failedJobNamesOf(body.jobs ?? [])
  }

  private async get<T>(args: {
    source: EGithubCallSource
    token: string
    path: string
  }): Promise<T> {
    const response = await githubFetch({
      source: args.source,
      url: `${this.baseUrl}${args.path}`,
      init: {
        headers: {
          authorization: `Bearer ${args.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      },
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, DETAIL_CAP)
      throw new GithubUserReadFailed(
        `github answered ${response.status} for ${args.path}: ${detail}`,
        response.status,
      )
    }
    return (await response.json()) as T
  }
}
