import type { GithubPrStateRecord } from './github-realtime.types'
import type { GithubWebhookPullRequest } from './github-webhook.types'

export function payloadFieldsOf(args: {
  pull: GithubWebhookPullRequest
}): GithubPrStateRecord {
  const state =
    args.pull.state === 'open'
      ? args.pull.draft
        ? 'draft'
        : 'open'
      : args.pull.merged_at === null
        ? 'closed'
        : 'merged'
  return {
    title: args.pull.title,
    url: args.pull.html_url,
    state,
    headBranch: args.pull.head.ref,
    headSha: args.pull.head.sha,
    headRepoFullName: args.pull.head.repo?.full_name ?? null,
    checksRunning: 0,
    checksPassed: 0,
    checksFailed: 0,
    mergeable: null,
    updatedAt: new Date(),
  }
}

export function parseHookRepoParam(args: { repo: string }): string | null {
  const parts = decodeURIComponent(args.repo).split('/')
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
    return null
  }
  return `${owner}/${repo}`
}
