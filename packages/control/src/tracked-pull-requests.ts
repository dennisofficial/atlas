import type {
  PrRef,
  PrStateRow,
  SessionBranchRow,
  SessionPullRequestRow,
  TrackedPullRequestRow,
} from './port'
import { repoFullNameOf } from './repo-name'

const OPEN_STATES: ReadonlySet<string> = new Set(['open', 'draft'])

const headKey = (head: { headRepo: string; branch: string }): string =>
  `${head.headRepo}\u0000${head.branch}`

const prKey = (pullRequest: PrRef): string =>
  `${repoFullNameOf(pullRequest.repo)}#${pullRequest.number}`

const instantOf = (iso: string | null | undefined): number | null => {
  if (iso === null || iso === undefined) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

const endedAtOf = (state: PrStateRow): number | null => {
  const closed = instantOf(state.closedAt)
  const merged = instantOf(state.mergedAt)
  if (closed === null || merged === null) return closed ?? merged
  return Math.min(closed, merged)
}

const seenWhileLive = (args: { state: PrStateRow; branch: SessionBranchRow }): boolean => {
  const endedAt = endedAtOf(args.state)
  if (endedAt === null) return true
  const firstSeenAt = instantOf(args.branch.firstSeenAt)
  return firstSeenAt === null || endedAt >= firstSeenAt
}

export const pullRequestUrlOf = (args: { repo: string; number: number }): string =>
  `https://github.com/${args.repo}/pull/${args.number}`

const byPriority = (left: TrackedPullRequestRow, right: TrackedPullRequestRow): number => {
  const openRank =
    Number(!OPEN_STATES.has(left.state.state)) - Number(!OPEN_STATES.has(right.state.state))
  if (openRank !== 0) return openRank
  const updated = right.state.updatedAt.localeCompare(left.state.updatedAt)
  if (updated !== 0) return updated
  return left.repo.localeCompare(right.repo) || left.number - right.number
}

const rowOf = (args: {
  sessionId: string
  state: PrStateRow
  branch: string
}): TrackedPullRequestRow => ({
  sessionId: args.sessionId,
  repo: args.state.repo,
  number: args.state.number,
  url: pullRequestUrlOf({ repo: args.state.repo, number: args.state.number }),
  branch: args.branch,
  state: {
    title: args.state.title,
    state: args.state.state,
    headSha: args.state.headSha,
    checks: {
      running: args.state.checksRunning,
      passed: args.state.checksPassed,
      failed: args.state.checksFailed,
    },
    mergeable: args.state.mergeable,
    updatedAt: args.state.updatedAt,
  },
})

export const trackedPullRequestsOf = (args: {
  branches: readonly SessionBranchRow[]
  subscriptions: readonly SessionPullRequestRow[]
  states: readonly PrStateRow[]
}): TrackedPullRequestRow[] => {
  const statesByHead = new Map<string, PrStateRow[]>()
  for (const state of args.states) {
    if (state.headRepoFullName == null || state.headBranch === undefined) continue
    const key = headKey({ headRepo: state.headRepoFullName, branch: state.headBranch })
    statesByHead.set(key, [...(statesByHead.get(key) ?? []), state])
  }
  const statesByNumber = new Map<string, PrStateRow>()
  for (const state of args.states) statesByNumber.set(prKey(state), state)

  const bySession = new Map<string, TrackedPullRequestRow[]>()
  const listed = new Set<string>()
  const list = (row: TrackedPullRequestRow): void => {
    const key = `${row.sessionId}\u0000${prKey(row)}`
    if (listed.has(key)) return
    listed.add(key)
    bySession.set(row.sessionId, [...(bySession.get(row.sessionId) ?? []), row])
  }

  for (const branch of args.branches) {
    const matches = statesByHead.get(headKey({ headRepo: branch.headRepo, branch: branch.branch }))
    for (const state of matches ?? []) {
      if (!seenWhileLive({ state, branch })) continue
      list(rowOf({ sessionId: branch.sessionId, state, branch: branch.branch }))
    }
  }
  for (const subscription of args.subscriptions) {
    const state = statesByNumber.get(prKey(subscription))
    if (state === undefined) continue
    list(
      rowOf({
        sessionId: subscription.sessionId,
        state,
        branch: state.headBranch ?? '',
      }),
    )
  }
  return [...bySession.values()].flatMap((rows) => [...rows].sort(byPriority))
}
