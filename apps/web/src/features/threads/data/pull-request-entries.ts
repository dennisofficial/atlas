import { GITHUB_REPO_PATTERN, type PrStateWire, type WireThread } from '@dltech/atlas-wire/web'

export type PullRequestEntry = {
  repo: string
  number: number
  url: string
  branch: string
  state: string | undefined
  title?: string | undefined
  checksRunning: number | undefined
  checksPassed: number | undefined
  checksFailed: number | undefined
  mergeable: boolean | null | undefined
  current: boolean
  via: { threadId: string; title: string | null } | undefined
}

function repoIdentityOf(repo: string): string | undefined {
  let path = repo.trim()
  if (path.includes('://')) {
    try {
      const url = new URL(path)
      if (
        url.hostname.toLowerCase() !== 'github.com' ||
        !['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)
      ) {
        return undefined
      }
      path = url.pathname.replace(/^\//, '')
    } catch {
      return undefined
    }
  } else {
    path = path.replace(/^(?:github\.com\/|git@github\.com:)/i, '')
  }
  path = path.replace(/\/+$/, '').replace(/\.git$/i, '')
  return GITHUB_REPO_PATTERN.test(path) ? path.toLowerCase() : undefined
}

export const pullRequestKeyOf = (pullRequest: { repo: string; number: number }): string =>
  `${repoIdentityOf(pullRequest.repo) ?? pullRequest.repo.toLowerCase()}#${pullRequest.number}`

function entryOf(args: {
  repo: string
  number: number
  url: string
  branch: string
  state?: string | undefined
  title?: string | undefined
  checksRunning?: number | undefined
  checksPassed?: number | undefined
  checksFailed?: number | undefined
  mergeable?: boolean | null | undefined
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
    title: live?.title ?? args.title,
    checksRunning: live?.checksRunning ?? args.checksRunning,
    checksPassed: live?.checksPassed ?? args.checksPassed,
    checksFailed: live?.checksFailed ?? args.checksFailed,
    mergeable: live === undefined ? args.mergeable : live.mergeable,
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

  const discoveryRepos =
    thread.repo === null || thread.repo === undefined
      ? linked.filter((pr) => pr.via === undefined).map((pr) => repoIdentityOf(pr.repo))
      : [repoIdentityOf(thread.repo)]
  const knownRepos = new Set(discoveryRepos.filter((repo) => repo !== undefined))
  const linkedIdentities = new Set(linked.map(pullRequestKeyOf))
  const unlinked = states
    .filter((state) => {
      const repo = repoIdentityOf(state.repo)
      return (
        repo !== undefined &&
        knownRepos.has(repo) &&
        state.branch === currentBranch &&
        !linkedIdentities.has(pullRequestKeyOf(state))
      )
    })
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
