import type { MergeabilitySample } from '@dltech/atlas-core'
import type { EGithubCallSource } from './github-call-log'
import type { CommitCheckInput } from './github-commit-checks'
import { readChecksState } from './github-checks-state'
import { readHeadChecks } from './github-head-checks-read'
import {
  pullRequestCacheFieldsOf,
  type PullRequestCacheFields,
  type RestPullRequest,
} from './github-pull-request-mapping'
import { mergeabilitySampleOfRest } from './github-pr-observations'
import type { GithubRequiredChecksRead } from './github-required-checks-read'

export type PullRequestRead = {
  pull: RestPullRequest
  mergeability: MergeabilitySample
  headSha: string
  fields: PullRequestCacheFields
  checks: CommitCheckInput[]
}

export async function readPullRequestFill(args: {
  get: <T>(args: { source: EGithubCallSource; token: string; path: string }) => Promise<T>
  requiredChecks: GithubRequiredChecksRead
  baseUrl: string
  source: EGithubCallSource
  token: string
  owner: string
  repo: string
  number: number
  observedAt: string
}): Promise<PullRequestRead> {
  const pull = await args.get<RestPullRequest>({
    source: args.source,
    token: args.token,
    path: `/repos/${args.owner}/${args.repo}/pulls/${args.number}`,
  })
  const head = await readHeadChecks({
    get: <T>(path: string) => args.get<T>({ source: args.source, token: args.token, path }),
    owner: args.owner,
    repo: args.repo,
    headSha: pull.head.sha,
  })
  const requiredCheckContexts = await args.requiredChecks.read({
    source: args.source,
    token: args.token,
    owner: args.owner,
    repo: args.repo,
    branch: pull.base.ref,
  })
  const checksState = await readChecksState({
    source: args.source,
    token: args.token,
    owner: args.owner,
    repo: args.repo,
    number: args.number,
    baseUrl: args.baseUrl,
  })
  return {
    pull,
    mergeability: mergeabilitySampleOfRest({ pull, observedAt: args.observedAt }),
    headSha: pull.head.sha,
    checks: head.checks,
    fields: pullRequestCacheFieldsOf({
      pull,
      checkRuns: head.checkRuns,
      statuses: head.statuses,
      checksState,
      requiredCheckContexts,
    }),
  }
}
