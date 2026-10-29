import { EPullRequestStateWire, type PrStateWire, type WireThread } from '@dltech/atlas-wire/web'

import {
  pinnedPullRequestOf,
  pullRequestEntriesOf,
  type PullRequestEntry,
} from './pull-request-entries'

export enum EHeaderState {
  Failed = 'failed',
  NeedsYou = 'needs-you',
  Running = 'running',
  Idle = 'idle',
}

export type ChecksTally = { running: number; passed: number; failed: number }

export type PullRequestBadge = {
  label: string
  stateLabel: string | undefined
  url: string
  checks?: ChecksTally | undefined
  mergeable?: boolean | undefined
  overflow: number
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
  return livePullRequestBadgeOf({ states: [], thread })
}

export const hasConflicts = (badge: PullRequestBadge): boolean =>
  badge.mergeable === false && badge.stateLabel === capitalized(EPullRequestStateWire.Open)

export const entryHasConflicts = (entry: PullRequestEntry): boolean =>
  entry.mergeable === false && entry.state === EPullRequestStateWire.Open

export function checksTallyOf(entry: PullRequestEntry): ChecksTally | undefined {
  const running = entry.checksRunning ?? 0
  const passed = entry.checksPassed ?? 0
  const failed = entry.checksFailed ?? 0
  if (running + passed + failed === 0) return undefined
  return { running, passed, failed }
}

export function livePullRequestBadgeOf(args: {
  states: readonly PrStateWire[]
  thread: WireThread | undefined
}): PullRequestBadge | undefined {
  if (args.thread === undefined) return undefined
  const entries = pullRequestEntriesOf({
    thread: args.thread,
    states: args.states,
  })
  const pinned = pinnedPullRequestOf(entries)
  if (pinned === undefined) return undefined
  return {
    label: `#${pinned.number}`,
    stateLabel: pinned.state === undefined ? undefined : capitalized(pinned.state),
    url: pinned.url,
    checks: checksTallyOf(pinned),
    ...(pinned.mergeable === null || pinned.mergeable === undefined
      ? {}
      : { mergeable: pinned.mergeable }),
    overflow: entries.length - 1,
  }
}
