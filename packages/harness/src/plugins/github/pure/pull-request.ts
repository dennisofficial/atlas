import { EPullRequestState } from '@dltech/atlas-core'

export { EPullRequestState }

export enum EChecksState {
  None = 'none',
  Running = 'running',
  Passing = 'passing',
  Failing = 'failing',
}

export type ChecksTally = { running: number; passed: number; failed: number }

export const NO_CHECKS: ChecksTally = { running: 0, passed: 0, failed: 0 }

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
  state: EPullRequestState
  checks: EChecksState
  tally: ChecksTally
  mergeable: boolean | null
  comments: readonly PrComment[]
  reviews: readonly PrReview[]
}

export type PullRequestBadge = {
  label: string
  url: string
  state: EPullRequestState
  checks: EChecksState
}

const SETTLED_STATES = new Set([EPullRequestState.Merged, EPullRequestState.Closed])

export function pullRequestBadge(pullRequest: PullRequest): PullRequestBadge {
  return {
    label: `#${pullRequest.number}`,
    url: pullRequest.url,
    state: pullRequest.state,
    checks: SETTLED_STATES.has(pullRequest.state) ? EChecksState.None : pullRequest.checks,
  }
}
