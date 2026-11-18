import type { PrStateRow, SessionBranchRow, TrackedPullRequestRow } from './port'

const OPEN_STATES: ReadonlySet<string> = new Set(['open', 'draft'])

const headKey = (head: { headRepo: string; branch: string }): string =>
  `${head.headRepo}\u0000${head.branch}`

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

export const trackedPullRequestsOf = (args: {
  branches: readonly SessionBranchRow[]
  states: readonly PrStateRow[]
}): TrackedPullRequestRow[] => {
  const statesByHead = new Map<string, PrStateRow[]>()
  for (const state of args.states) {
    if (state.headRepoFullName == null || state.headBranch === undefined) continue
    const key = headKey({ headRepo: state.headRepoFullName, branch: state.headBranch })
    statesByHead.set(key, [...(statesByHead.get(key) ?? []), state])
  }
  const bySession = new Map<string, TrackedPullRequestRow[]>()
  for (const branch of args.branches) {
    const matches = statesByHead.get(headKey({ headRepo: branch.headRepo, branch: branch.branch }))
    if (matches === undefined) continue
    for (const state of matches) {
      const rows = bySession.get(branch.sessionId) ?? []
      rows.push({
        sessionId: branch.sessionId,
        repo: state.repo,
        number: state.number,
        url: pullRequestUrlOf({ repo: state.repo, number: state.number }),
        branch: branch.branch,
        state: {
          title: state.title,
          state: state.state,
          headSha: state.headSha,
          checks: {
            running: state.checksRunning,
            passed: state.checksPassed,
            failed: state.checksFailed,
          },
          mergeable: state.mergeable,
          updatedAt: state.updatedAt,
        },
      })
      bySession.set(branch.sessionId, rows)
    }
  }
  return [...bySession.values()].flatMap((rows) => [...rows].sort(byPriority))
}
