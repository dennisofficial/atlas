import type { MergeabilitySample } from '@dltech/atlas-core'
import type { BranchProtectionRead } from './github-branch-protection'
import type { EGithubCallSource } from './github-call-log'
import type { CommitCheckInput } from './github-commit-checks'
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
  protection: BranchProtectionRead
}

export async function readPullRequestFill(args: {
  get: <T>(args: { source: EGithubCallSource; token: string; path: string }) => Promise<T>
  requiredChecks: GithubRequiredChecksRead
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
  const protection = await args.requiredChecks.read({
    source: args.source,
    token: args.token,
    owner: args.owner,
    repo: args.repo,
    branch: pull.base.ref,
  })
  return {
    pull,
    mergeability: mergeabilitySampleOfRest({ pull, observedAt: args.observedAt }),
    headSha: pull.head.sha,
    checks: head.checks,
    protection: { baseBranch: pull.base.ref, ...protection },
    fields: pullRequestCacheFieldsOf({
      pull,
      checkRuns: head.checkRuns,
      statuses: head.statuses,
    }),
  }
}
