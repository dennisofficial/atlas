import type { SubscriptionBy } from './sse-pull-request-book'
import { EPullRequestLookup, type PullRequestReading } from '../plugins/github/pure'

export const GITHUB_HOST = 'github.com'

export const unavailable = (retryable: boolean): PullRequestReading => ({
  lookup: EPullRequestLookup.Unavailable,
  retryable,
})

export const subscribeTargetOf = (args: {
  repoFullName: string
  by: SubscriptionBy
}): { repoFullName: string; branch: string } | { repoFullName: string; number: number } =>
  args.by.kind === 'branch'
    ? { repoFullName: args.repoFullName, branch: args.by.branch }
    : { repoFullName: args.repoFullName, number: args.by.number }

export const repoFullNameOf = (repo: string): string | null => {
  const [host, owner, name, ...extra] = repo.split('/')
  if (extra.length > 0 || host !== GITHUB_HOST || owner === undefined || name === undefined) {
    return null
  }
  return `${owner}/${name}`
}
