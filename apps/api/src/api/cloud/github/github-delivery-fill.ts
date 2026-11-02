import type { Logger } from '@nestjs/common'
import { EGithubCallSource } from './github-call-log'
import { GithubHttpBudgetUnavailable } from './github-request-budget'
import type { CommitCheckInput } from './github-commit-checks'
import type { GithubPrStateRecord } from './github-realtime.types'
import { GithubUserReadFailed, type GithubUserReads } from './github-user-reads'

export type RestFill =
  | { kind: 'filled'; fields: GithubPrStateRecord; checks: CommitCheckInput[] | null }
  | { kind: 'skipped' }
  | { kind: 'deferred' }

export class GithubDeliveryFillDeferred extends Error {
  constructor(args: { repoFullName: string; prNumbers: number[] }) {
    super(
      `REST fill deferred by the GitHub budget for ${args.repoFullName} ${args.prNumbers.map((n) => `#${n}`).join(', ')}`,
    )
  }
}

export async function tryRestFill(args: {
  reads: GithubUserReads
  logger: Logger
  token: string
  owner: string
  repo: string
  prNumber: number
  collect?: boolean
}): Promise<RestFill> {
  let collected: CommitCheckInput[] | null = null
  try {
    const fields = await args.reads.readPullRequest({
      source: EGithubCallSource.DeliveryFill,
      token: args.token,
      owner: args.owner,
      repo: args.repo,
      number: args.prNumber,
      ...(args.collect === true
        ? {
            collectChecks: ({ checks }: { checks: CommitCheckInput[] }) => {
              collected = checks
            },
          }
        : {}),
    })
    return { kind: 'filled', fields: { ...fields, updatedAt: new Date() }, checks: collected }
  } catch (failure) {
    if (
      failure instanceof GithubUserReadFailed &&
      (failure.status === 401 || failure.status === 404)
    ) {
      return { kind: 'skipped' }
    }
    args.logger.warn(
      `REST fill for ${args.owner}/${args.repo}#${args.prNumber} failed: ${String(failure)}`,
    )
    return failure instanceof GithubHttpBudgetUnavailable
      ? { kind: 'deferred' }
      : { kind: 'skipped' }
  }
}
