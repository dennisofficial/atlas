import {
  ECheckOutcome,
  ETargetPhase,
  checksTally,
  type JsonValue,
  type SubscriptionTargetState,
  type SubscriptionTargetStates,
  UNKNOWN_TARGET_STATE,
} from '@dltech/atlas-core'
import {
  GITHUB_PROVIDER,
  GITHUB_RUN_PROVIDER,
  type PullRequestChecks,
  type PullRequestReview,
  type WorkflowRunJob,
  pullRequestSnapshotOf,
  pullRequestStateOf,
  repoFullNameOf,
  runSnapshotOf,
  runStateOf,
  runTargetOf,
  targetOf,
} from '@dltech/atlas-plugin-github/core'

import { EGithubCallSource } from './github-call-log'
import { pendingCheckSuiteCountOf } from './github-check-suites'
import { readHeadCheckSuites, readHeadChecks } from './github-head-checks-read'
import { githubJsonGet } from './github-user-http'

type PullResponse = {
  state: string
  merged_at: string | null
  draft?: boolean
  html_url: string
  mergeable?: boolean | null
  head?: { sha?: string | null } | null
  base?: { ref?: string | null } | null
}

type RunResponse = {
  id: number
  status: string
  conclusion: string | null
  name: string
  html_url: string
  head_branch: string | null
}

type JobResponse = { name: string; status: string; conclusion: string | null }

type JobsResponse = { jobs?: readonly JobResponse[] }

type ReviewsResponse = readonly { user?: { login?: string | null } | null; state?: string | null }[]

export class GithubSubscriptionTargetStates implements SubscriptionTargetStates {
  constructor(
    private readonly deps: {
      tokenFor: (args: { userId: string; repoFullName: string }) => Promise<string | undefined>
    },
  ) {}

  async read(args: {
    userId: string
    provider: string
    target: JsonValue
  }): Promise<SubscriptionTargetState> {
    try {
      if (args.provider === GITHUB_PROVIDER) return await this.readPullRequest(args)
      if (args.provider === GITHUB_RUN_PROVIDER) return await this.readRun(args)
      return UNKNOWN_TARGET_STATE
    } catch {
      return UNKNOWN_TARGET_STATE
    }
  }

  private async readPullRequest(args: {
    userId: string
    target: JsonValue
  }): Promise<SubscriptionTargetState> {
    const target = targetOf(args.target)
    if (target === null) return UNKNOWN_TARGET_STATE
    const repoFullName = repoFullNameOf(target.repo)
    const token = await this.deps.tokenFor({ userId: args.userId, repoFullName })
    if (token === undefined) return UNKNOWN_TARGET_STATE

    const pull = await githubJsonGet<PullResponse>({
      source: EGithubCallSource.SubscriptionResolve,
      token,
      path: `/repos/${repoFullName}/pulls/${target.number}`,
    })
    const state = pullRequestStateOf({ target, pull })
    if (state.phase !== ETargetPhase.Open) return state
    const headSha = pull.head?.sha ?? null
    const head = await this.headStateOf({ token, repoFullName, headSha })
    return {
      ...state,
      snapshot: pullRequestSnapshotOf({
        draft: pull.draft === true,
        headSha,
        mergeable: pull.mergeable ?? null,
        baseBranch: pull.base?.ref ?? null,
        checks: head.checks,
        pendingSuites: head.pendingSuites,
        reviews: await this.reviewsOf({ token, repoFullName, number: target.number }),
      }),
    }
  }

  private async readRun(args: {
    userId: string
    target: JsonValue
  }): Promise<SubscriptionTargetState> {
    const target = runTargetOf(args.target)
    if (target === null || target.kind !== 'run') return UNKNOWN_TARGET_STATE
    const repoFullName = repoFullNameOf(target.repo)
    const token = await this.deps.tokenFor({ userId: args.userId, repoFullName })
    if (token === undefined) return UNKNOWN_TARGET_STATE

    const run = await githubJsonGet<RunResponse>({
      source: EGithubCallSource.SubscriptionResolve,
      token,
      path: `/repos/${repoFullName}/actions/runs/${target.runId}`,
    })
    const jobs =
      run.status === 'completed' && run.conclusion !== 'failure'
        ? []
        : await this.jobsOf({ token, repoFullName, runId: target.runId })
    const state = runStateOf({ target, run, failedJobs: failedJobNames(jobs) })
    if (state.phase !== ETargetPhase.Open) return state
    return { ...state, snapshot: runSnapshotOf(jobs) }
  }

  private async headStateOf(args: {
    token: string
    repoFullName: string
    headSha: string | null
  }): Promise<{ checks: PullRequestChecks | undefined; pendingSuites: number | undefined }> {
    const unknown = { checks: undefined, pendingSuites: undefined }
    if (args.headSha === null || args.headSha === '') return unknown
    const [owner, repo] = args.repoFullName.split('/') as [string | undefined, string | undefined]
    if (owner === undefined || repo === undefined) return unknown
    const get = <T>(path: string): Promise<T> =>
      githubJsonGet<T>({
        source: EGithubCallSource.SubscriptionResolve,
        token: args.token,
        path,
      })
    return {
      checks: await this.checksOf({ get, owner, repo, headSha: args.headSha }),
      pendingSuites: await this.pendingSuitesOf({ get, owner, repo, headSha: args.headSha }),
    }
  }

  private async checksOf(args: {
    get: <T>(path: string) => Promise<T>
    owner: string
    repo: string
    headSha: string
  }): Promise<PullRequestChecks | undefined> {
    try {
      const { checks } = await readHeadChecks(args)
      return {
        tally: checksTally(checks.map((check) => check.outcome)),
        failedNames: checks
          .filter((check) => check.outcome === ECheckOutcome.Failed)
          .map((check) => check.name),
      }
    } catch {
      return undefined
    }
  }

  private async pendingSuitesOf(args: {
    get: <T>(path: string) => Promise<T>
    owner: string
    repo: string
    headSha: string
  }): Promise<number | undefined> {
    try {
      return pendingCheckSuiteCountOf(await readHeadCheckSuites(args))
    } catch {
      return undefined
    }
  }

  private async reviewsOf(args: {
    token: string
    repoFullName: string
    number: number
  }): Promise<readonly PullRequestReview[] | undefined> {
    try {
      const reviews = await githubJsonGet<ReviewsResponse>({
        source: EGithubCallSource.SubscriptionResolve,
        token: args.token,
        path: `/repos/${args.repoFullName}/pulls/${args.number}/reviews?per_page=100`,
      })
      return reviews.flatMap((review) => {
        const author = review.user?.login
        const state = review.state
        return author === undefined || author === null || typeof state !== 'string'
          ? []
          : [{ author, state }]
      })
    } catch {
      return undefined
    }
  }

  private async jobsOf(args: {
    token: string
    repoFullName: string
    runId: number
  }): Promise<readonly WorkflowRunJob[] | undefined> {
    try {
      const page = await githubJsonGet<JobsResponse>({
        source: EGithubCallSource.SubscriptionResolve,
        token: args.token,
        path: `/repos/${args.repoFullName}/actions/runs/${args.runId}/jobs?per_page=100`,
      })
      return (page.jobs ?? []).map((job) => ({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
      }))
    } catch {
      return undefined
    }
  }
}

const failedJobNames = (jobs: readonly WorkflowRunJob[] | undefined): readonly string[] =>
  (jobs ?? []).filter((job) => job.conclusion === 'failure').map((job) => job.name)
