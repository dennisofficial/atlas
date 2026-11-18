import type { Logger } from '@nestjs/common'
import type { MergeabilitySample } from '@dltech/atlas-core'
import type { BranchProtectionRead } from './github-branch-protection'
import { EGithubCallSource } from './github-call-log'
import { GithubHttpBudgetUnavailable } from './github-request-budget'
import type { CommitCheckInput } from './github-commit-checks'
import type { PullRequestCacheFields, RestPullRequest } from './github-pull-request-mapping'
import { GithubUserReadFailed, type GithubUserReads } from './github-user-reads'

export type FillFields = PullRequestCacheFields & { updatedAt: Date; baseBranch: string }

export type RestFill =
  | {
      kind: 'filled'
      fields: FillFields
      checks: CommitCheckInput[] | null
      protection: BranchProtectionRead | null
    }
  | { kind: 'skipped' }
  | { kind: 'deferred' }

export type RestPull =
  | { kind: 'filled'; pull: RestPullRequest; mergeability: MergeabilitySample }
  | { kind: 'skipped' }
  | { kind: 'deferred' }

export class GithubDeliveryFillDeferred extends Error {
  readonly parked = true

  constructor(args: { repoFullName: string; prNumbers: number[] }) {
    super(
      `REST fill deferred by the GitHub budget for ${args.repoFullName} ${args.prNumbers.map((n) => `#${n}`).join(', ')}`,
    )
  }
}

export async function tryRestPull(args: {
  reads: GithubUserReads
  logger: Logger
  token: string
  owner: string
  repo: string
  prNumber: number
}): Promise<RestPull> {
  try {
    const read = await args.reads.readPullRequestObservation({
      source: EGithubCallSource.DeliveryFill,
      token: args.token,
      owner: args.owner,
      repo: args.repo,
      number: args.prNumber,
    })

    return { kind: 'filled', pull: read.pull, mergeability: read.mergeability }
  } catch (failure) {
    return failureOutcomeOf({
      failure,
      logger: args.logger,
      label: `REST fill for ${args.owner}/${args.repo}#${args.prNumber}`,
    })
  }
}

function failureOutcomeOf(args: {
  failure: unknown
  logger: Logger
  label: string
}): { kind: 'skipped' } | { kind: 'deferred' } {
  if (
    args.failure instanceof GithubUserReadFailed &&
    (args.failure.status === 401 || args.failure.status === 404)
  ) {
    return { kind: 'skipped' }
  }
  args.logger.warn(`${args.label} failed: ${String(args.failure)}`)

  return args.failure instanceof GithubHttpBudgetUnavailable
    ? { kind: 'deferred' }
    : { kind: 'skipped' }
}

export async function tryRestFill(args: {
  reads: GithubUserReads
  logger: Logger
  token: string
  owner: string
  repo: string
  prNumber: number
}): Promise<RestFill> {
  let collected: CommitCheckInput[] = []
  const held: { protection: BranchProtectionRead | null } = { protection: null }
  const protectionOf = (): BranchProtectionRead | null => held.protection
  try {
    const fields = await args.reads.readPullRequest({
      source: EGithubCallSource.DeliveryFill,
      token: args.token,
      owner: args.owner,
      repo: args.repo,
      number: args.prNumber,
      collectChecks: ({ checks }) => {
        collected = [...checks]
      },
      collectRequiredContexts: (value) => {
        held.protection = value
      },
    })
    return {
      kind: 'filled',
      fields: {
        ...fields,
        baseBranch: protectionOf()?.baseBranch ?? '',
        updatedAt: new Date(),
      },
      checks: collected,
      protection: protectionOf(),
    }
  } catch (failure) {
    return failureOutcomeOf({
      failure,
      logger: args.logger,
      label: `REST fill for ${args.owner}/${args.repo}#${args.prNumber}`,
    })
  }
}
