import { EChecksState, EPullRequestState, NO_CHECKS, type ChecksTally } from '@dltech/atlas-core'

export { EChecksState, EPullRequestState, NO_CHECKS, type ChecksTally }

export type PrComment = {
  id: string
  authorLogin: string | null
  body: string
  url: string
  createdAt: string
}

export type PrReview = {
  id: string
  authorLogin: string | null
  state: string
  body: string
}

export type PullRequest = {
  number: number
  title: string
  url: string
  headSha?: string
  state: EPullRequestState
  checks: EChecksState
  tally: ChecksTally
  mergeable: boolean | null
  comments: readonly PrComment[]
  reviews: readonly PrReview[]
  pollBacked?: boolean
}

export type PullRequestBadge = {
  label: string
  url: string
  state: EPullRequestState
  checks: EChecksState
  pollBacked: boolean
}

const SETTLED_STATES = new Set([EPullRequestState.Merged, EPullRequestState.Closed])

export function pullRequestBadge(pullRequest: PullRequest): PullRequestBadge {
  return {
    label: `#${pullRequest.number}`,
    url: pullRequest.url,
    state: pullRequest.state,
    checks: SETTLED_STATES.has(pullRequest.state) ? EChecksState.None : pullRequest.checks,
    pollBacked: pullRequest.pollBacked === true,
  }
}
