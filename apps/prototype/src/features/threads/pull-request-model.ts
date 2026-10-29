export enum EPrState {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
}

export enum EPrDesign {
  PinnedPopover = 'A',
  InlineSplit = 'B',
  Panel = 'C',
}

export interface PrChecks {
  running: number
  failing: number
  passing: number
}

export interface PullRequest {
  number: number
  title: string
  branch: string
  state: EPrState
  current: boolean
  watched: boolean
  conflicts: boolean
  checks?: PrChecks
  url: string
}

export interface PullRequestsConfig {
  design: EPrDesign
  prs: PullRequest[]
}

export const MAX_PULL_REQUESTS = 4

const REPO_URL = 'https://github.com/dennisofficial/atlas/pull'

export const PULL_REQUEST_FIXTURES: PullRequest[] = [
  {
    number: 1460,
    title: 'Add thread header skeleton',
    branch: 'dennis/header-skeleton',
    state: EPrState.Closed,
    current: false,
    watched: false,
    conflicts: false,
    url: `${REPO_URL}/1460`,
  },
  {
    number: 1467,
    title: 'Move tokens into the ui package',
    branch: 'dennis/ui-tokens',
    state: EPrState.Merged,
    current: false,
    watched: true,
    conflicts: false,
    checks: { running: 0, failing: 0, passing: 12 },
    url: `${REPO_URL}/1467`,
  },
  {
    number: 1469,
    title: 'Rebase ui on shadcn base-nova',
    branch: 'dennis/shadcn-ui-storybook',
    state: EPrState.Open,
    current: true,
    watched: true,
    conflicts: false,
    checks: { running: 3, failing: 0, passing: 9 },
    url: `${REPO_URL}/1469`,
  },
  {
    number: 1472,
    title: 'Port web header to base-nova',
    branch: 'dennis/web-header-port',
    state: EPrState.Draft,
    current: false,
    watched: false,
    conflicts: true,
    checks: { running: 0, failing: 1, passing: 10 },
    url: `${REPO_URL}/1472`,
  },
]

const INCLUSION_PRIORITY = [1469, 1472, 1467, 1460]

export function pullRequestsOf(count: number): PullRequest[] {
  const size = Math.min(MAX_PULL_REQUESTS, Math.max(0, Math.floor(count)))
  const included = INCLUSION_PRIORITY.slice(0, size)
  return PULL_REQUEST_FIXTURES.filter((pr) => included.includes(pr.number))
}

export function pinnedOf(prs: PullRequest[]): PullRequest | undefined {
  return prs.find((pr) => pr.current) ?? prs[prs.length - 1]
}

export function othersOf(prs: PullRequest[]): PullRequest[] {
  const pinned = pinnedOf(prs)
  return prs.filter((pr) => pr !== pinned)
}

export function toggleWatched({
  prs,
  number,
}: {
  prs: PullRequest[]
  number: number
}): PullRequest[] {
  return prs.map((pr) => (pr.number === number ? { ...pr, watched: !pr.watched } : pr))
}

export function checksLabelOf(pr: PullRequest): string | undefined {
  if (!pr.checks) return undefined
  if (pr.checks.failing > 0) return `${pr.checks.failing} failing`
  if (pr.checks.running > 0) return `${pr.checks.running} running`
  return 'Passing'
}

export const PR_STATE_LABEL: Record<EPrState, string> = {
  [EPrState.Open]: 'Open',
  [EPrState.Draft]: 'Draft',
  [EPrState.Merged]: 'Merged',
  [EPrState.Closed]: 'Closed',
}

export function bellLabelOf(pr: PullRequest): string {
  return pr.watched ? 'Unwatch pull request' : 'Watch pull request'
}
