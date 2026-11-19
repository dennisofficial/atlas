import type {
  PrHead,
  PrRef,
  PrStateRow,
  SessionBranchRow,
  SessionPullRequestRow,
  SessionViewRow,
  TrackedPullRequestRow,
} from '../../port'
import { repoFullNameOf } from '../../repo-name'
import { trackedPullRequestsOf } from '../../tracked-pull-requests'
import { branchKey, prKey, sessionPullRequestKey, type State } from './memory-state'

export const readSessionViewIn = (params: {
  state: State
  sessionId: string
}): SessionViewRow | undefined => {
  const row = params.state.views.get(params.sessionId)
  return row === undefined ? undefined : { ...row }
}

export const writeSessionViewIn = (params: { state: State; row: SessionViewRow }): void => {
  params.state.views.set(params.row.sessionId, { ...params.row })
}

export const insertSessionBranchesIn = (params: {
  state: State
  rows: readonly SessionBranchRow[]
}): void => {
  for (const row of params.rows) {
    const key = branchKey(row)
    if (params.state.sessionBranches.has(key)) continue
    params.state.sessionBranches.set(key, { ...row })
  }
}

export const insertSessionPullRequestsIn = (params: {
  state: State
  rows: readonly SessionPullRequestRow[]
}): void => {
  for (const row of params.rows) {
    const key = sessionPullRequestKey(row)
    if (params.state.sessionPullRequests.has(key)) continue
    params.state.sessionPullRequests.set(key, { ...row })
  }
}

export const sessionsTrackingHeadIn = (params: { state: State; head: PrHead }): string[] => {
  const sessionIds = [...params.state.sessionBranches.values()]
    .filter((row) => row.headRepo === params.head.headRepo && row.branch === params.head.branch)
    .map((row) => row.sessionId)
  return [...new Set(sessionIds)]
}

export const sessionsTrackingPullRequestIn = (params: {
  state: State
  pullRequest: PrRef
}): string[] => {
  const repo = repoFullNameOf(params.pullRequest.repo)
  const sessionIds = [...params.state.sessionPullRequests.values()]
    .filter((row) => repoFullNameOf(row.repo) === repo && row.number === params.pullRequest.number)
    .map((row) => row.sessionId)
  return [...new Set(sessionIds)]
}

const sessionBranchesIn = (params: {
  state: State
  sessionIds: readonly string[]
}): SessionBranchRow[] => {
  const wanted = new Set(params.sessionIds)
  return [...params.state.sessionBranches.values()]
    .filter((row) => wanted.has(row.sessionId))
    .map((row) => ({ ...row }))
}

const sessionPullRequestsIn = (params: {
  state: State
  sessionIds: readonly string[]
}): SessionPullRequestRow[] => {
  const wanted = new Set(params.sessionIds)
  return [...params.state.sessionPullRequests.values()]
    .filter((row) => wanted.has(row.sessionId))
    .map((row) => ({ ...row }))
}

const prStatesForHeadsIn = (params: { state: State; heads: readonly PrHead[] }): PrStateRow[] => {
  const wanted = new Set(params.heads.map((head) => `${head.headRepo}\u0000${head.branch}`))
  return [...params.state.prStates.values()]
    .filter(
      (row) =>
        row.headRepoFullName != null &&
        row.headBranch !== undefined &&
        wanted.has(`${row.headRepoFullName}\u0000${row.headBranch}`),
    )
    .map((row) => ({ ...row }))
}

const prStatesForNumbersIn = (params: {
  state: State
  pullRequests: readonly PrRef[]
}): PrStateRow[] => {
  const wanted = new Set(
    params.pullRequests.map(
      (pullRequest) => `${repoFullNameOf(pullRequest.repo)}#${pullRequest.number}`,
    ),
  )
  return [...params.state.prStates.values()]
    .filter((row) => wanted.has(`${repoFullNameOf(row.repo)}#${row.number}`))
    .map((row) => ({ ...row }))
}

export const readTrackedPullRequestsIn = (params: {
  state: State
  sessionIds: readonly string[]
}): TrackedPullRequestRow[] => {
  const branches = sessionBranchesIn(params)
  const subscriptions = sessionPullRequestsIn(params)
  return trackedPullRequestsOf({
    branches,
    subscriptions,
    states: [
      ...prStatesForHeadsIn({
        state: params.state,
        heads: branches.map((branch) => ({ headRepo: branch.headRepo, branch: branch.branch })),
      }),
      ...prStatesForNumbersIn({
        state: params.state,
        pullRequests: subscriptions.map((subscription) => ({
          repo: subscription.repo,
          number: subscription.number,
        })),
      }),
    ],
  })
}

export const prStateOf = (params: { state: State; key: { repo: string; number: number } }) =>
  params.state.prStates.get(prKey(params.key))
