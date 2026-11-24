import {
  type JsonValue,
  type SubscriptionTargetState,
  type SubscriptionTargetStates,
  UNKNOWN_TARGET_STATE,
} from '@dltech/atlas-core'
import {
  GITHUB_PROVIDER,
  GITHUB_RUN_PROVIDER,
  pullRequestStateOf,
  repoFullNameOf,
  runStateOf,
  runTargetOf,
  targetOf,
} from '@dltech/atlas-plugin-github/core'

import { EGithubCallSource } from './github-call-log'
import { githubJsonGet } from './github-user-http'

type PullResponse = {
  state: string
  merged_at: string | null
  draft?: boolean
  html_url: string
}

type RunResponse = {
  id: number
  status: string
  conclusion: string | null
  name: string
  html_url: string
  head_branch: string | null
}

type JobsResponse = { jobs?: readonly { name: string; conclusion: string | null }[] }

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
    return pullRequestStateOf({ target, pull })
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
    const failedJobs =
      run.status === 'completed' && run.conclusion === 'failure'
        ? await this.failedJobsOf({ token, repoFullName, runId: target.runId })
        : []
    return runStateOf({ target, run, failedJobs })
  }

  private async failedJobsOf(args: {
    token: string
    repoFullName: string
    runId: number
  }): Promise<readonly string[]> {
    try {
      const page = await githubJsonGet<JobsResponse>({
        source: EGithubCallSource.SubscriptionResolve,
        token: args.token,
        path: `/repos/${args.repoFullName}/actions/runs/${args.runId}/jobs?per_page=100`,
      })
      return (page.jobs ?? []).filter((job) => job.conclusion === 'failure').map((job) => job.name)
    } catch {
      return []
    }
  }
}
