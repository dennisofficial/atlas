import { EPullRequestStateWire, type PrStateWire, type WireThread } from '@dltech/atlas-wire/web'

import { linkedPullRequestOf } from '@/features/shell/thread-status'

export enum EHeaderState {
  Failed = 'failed',
  NeedsYou = 'needs-you',
  Running = 'running',
  Idle = 'idle',
}

export type PullRequestBadge = {
  label: string
  stateLabel: string | undefined
  url: string
  checksLabel?: string | undefined
  mergeable?: boolean | undefined
}

export const STATE_LABEL: Record<EHeaderState, string> = {
  [EHeaderState.Failed]: 'Failed',
  [EHeaderState.NeedsYou]: 'Needs you',
  [EHeaderState.Running]: 'Running',
  [EHeaderState.Idle]: 'Idle',
}

export function sandboxSettingsHrefOf(
  thread: { projectId?: string | null } | undefined,
): string | undefined {
  const projectId = thread?.projectId
  if (!projectId) return undefined
  return `/projects/${encodeURIComponent(projectId)}/settings/sandbox`
}

export function headerStateOf(args: {
  failed: boolean
  working: boolean
  waitingOnOperator: boolean
}): EHeaderState {
  if (args.failed) return EHeaderState.Failed
  if (args.waitingOnOperator) return EHeaderState.NeedsYou
  return args.working ? EHeaderState.Running : EHeaderState.Idle
}

export function spawnerIdOf(thread: WireThread | undefined): string | undefined {
  return thread?.agent?.spawnedBy
}

export function branchOf(thread: WireThread | undefined): string | undefined {
  const branch = thread?.worktree?.branch
  return branch === undefined || branch === '' ? undefined : branch
}

const capitalized = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

export function pullRequestBadgeOf(thread: WireThread | undefined): PullRequestBadge | undefined {
  if (thread === undefined) return undefined
  const pullRequest = linkedPullRequestOf(thread)
  if (pullRequest === undefined) return undefined
  return {
    label: `#${pullRequest.number}`,
    stateLabel: pullRequest.state === undefined ? undefined : capitalized(pullRequest.state),
    url: pullRequest.url,
  }
}

export const hasConflicts = (badge: PullRequestBadge): boolean =>
  badge.mergeable === false && badge.stateLabel === capitalized(EPullRequestStateWire.Open)

const SETTLED_STATES: ReadonlySet<EPullRequestStateWire> = new Set([
  EPullRequestStateWire.Merged,
  EPullRequestStateWire.Closed,
])

function checksLabelOf(state: PrStateWire): string | undefined {
  if (SETTLED_STATES.has(state.state)) return undefined
  if (state.checksFailed > 0) return `✕ ${state.checksFailed} failing`
  if (state.checksRunning > 0) return `${state.checksRunning} running`
  if (state.checksPassed > 0) return `✓ ${state.checksPassed} passing`
  return undefined
}

export function livePullRequestBadgeOf(args: {
  states: readonly PrStateWire[]
  thread: WireThread | undefined
}): PullRequestBadge | undefined {
  if (args.thread === undefined) return undefined
  const linked = linkedPullRequestOf(args.thread)
  if (linked === undefined) return undefined
  const state = args.states.find(
    (candidate) => candidate.repo === linked.repo && candidate.number === linked.number,
  )
  if (state === undefined) return undefined
  return {
    label: `#${state.number}`,
    stateLabel: capitalized(state.state),
    url: state.url,
    checksLabel: checksLabelOf(state),
    ...(state.mergeable === null ? {} : { mergeable: state.mergeable }),
  }
}
