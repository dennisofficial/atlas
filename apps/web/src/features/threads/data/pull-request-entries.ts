import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

export type PullRequestEntry = {
  repo: string
  number: number
  url: string
  branch: string
  state: string | undefined
  checksRunning: number | undefined
  checksPassed: number | undefined
  checksFailed: number | undefined
  mergeable: boolean | null | undefined
  current: boolean
  via: { threadId: string; title: string | null } | undefined
}

export const pullRequestKeyOf = (pullRequest: { repo: string; number: number }): string =>
  `${pullRequest.repo}#${pullRequest.number}`

function entryOf(args: {
  repo: string
  number: number
  url: string
  branch: string
  state?: string | undefined
  via?: { threadId: string; title: string | null } | undefined
  live: PrStateWire | undefined
  currentBranch: string | undefined
}): PullRequestEntry {
  const { live, branch, currentBranch } = args
  return {
    repo: args.repo,
    number: args.number,
    url: live?.url ?? args.url,
    branch,
    state: live?.state ?? args.state,
    checksRunning: live?.checksRunning,
    checksPassed: live?.checksPassed,
    checksFailed: live?.checksFailed,
    mergeable: live?.mergeable,
    current: currentBranch !== undefined && branch === currentBranch,
    via: args.via,
  }
}

export function pullRequestEntriesOf(args: {
  thread: WireThread
  states: readonly PrStateWire[]
}): PullRequestEntry[] {
  const { thread, states } = args
  const branch = thread.worktree?.branch
  const currentBranch = branch === undefined || branch === '' ? undefined : branch
  const liveByIdentity = new Map(states.map((state) => [pullRequestKeyOf(state), state]))
  const linked = (thread.pullRequests ?? []).map((pullRequest) =>
    entryOf({
      ...pullRequest,
      live: liveByIdentity.get(pullRequestKeyOf(pullRequest)),
      currentBranch,
    }),
  )
  if (currentBranch === undefined) return linked

  const linkedIdentities = new Set(linked.map(pullRequestKeyOf))
  const unlinked = states
    .filter(
      (state) => state.branch === currentBranch && !linkedIdentities.has(pullRequestKeyOf(state)),
    )
    .map((state) => entryOf({ ...state, live: state, currentBranch }))
  return [...linked, ...unlinked]
}

export function pinnedPullRequestOf(
  entries: readonly PullRequestEntry[],
): PullRequestEntry | undefined {
  return (
    entries.find((entry) => entry.current) ??
    entries.findLast((entry) => entry.via === undefined) ??
    entries.at(-1)
  )
}
