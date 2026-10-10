import { ForbiddenException } from '@nestjs/common'

import type { GithubPrStateDto, GithubSubscriptionDto } from './github-realtime.types'

export function parseRepo(args: { repoFullName: string }): { owner: string; repo: string } {
  const [owner, repo] = args.repoFullName.split('/')
  if (owner === undefined || repo === undefined || args.repoFullName.split('/').length !== 2) {
    throw new ForbiddenException('repo must be owner/name')
  }
  return { owner, repo }
}

export function subscriptionDtoOf(args: {
  subscription: {
    id: string
    repoFullName: string
    prNumber: number | null
    branch: string
    pollBacked: boolean
    expiresAt: Date
  }
  state: GithubPrStateDto | null
}): GithubSubscriptionDto {
  return {
    id: args.subscription.id,
    repoFullName: args.subscription.repoFullName,
    prNumber: args.subscription.prNumber,
    branch: args.subscription.branch,
    pollBacked: args.subscription.pollBacked,
    expiresAt: args.subscription.expiresAt.toISOString(),
    state: args.state,
  }
}
