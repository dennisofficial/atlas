import type {
  PrHead,
  PrStateRow,
  SessionBranchRow,
  SessionViewRow,
  TrackedPullRequestRow,
} from '../../port'
import { trackedPullRequestsOf } from '../../tracked-pull-requests'
import { branchKey, prKey, type State } from './memory-state'

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

export const sessionsTrackingHeadIn = (params: { state: State; head: PrHead }): string[] => {
  const sessionIds = [...params.state.sessionBranches.values()]
    .filter((row) => row.headRepo === params.head.headRepo && row.branch === params.head.branch)
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

export const readTrackedPullRequestsIn = (params: {
  state: State
  sessionIds: readonly string[]
}): TrackedPullRequestRow[] => {
  const branches = sessionBranchesIn(params)
  return trackedPullRequestsOf({
    branches,
    states: prStatesForHeadsIn({
      state: params.state,
      heads: branches.map((branch) => ({ headRepo: branch.headRepo, branch: branch.branch })),
    }),
  })
}

export const prStateOf = (params: { state: State; key: { repo: string; number: number } }) =>
  params.state.prStates.get(prKey(params.key))
