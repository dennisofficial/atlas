import { EPullRequestStateWire, type WireThread } from '@dltech/atlas-wire/web'

import type { PullRequestEntry } from './pull-request-entries'

export enum EHeaderState {
  Failed = 'failed',
  NeedsYou = 'needs-you',
  Running = 'running',
  Idle = 'idle',
  Unavailable = 'unavailable',
}

export type ChecksTally = { running: number; passed: number; failed: number }

export const STATE_LABEL: Record<EHeaderState, string> = {
  [EHeaderState.Failed]: 'Failed',
  [EHeaderState.NeedsYou]: 'Needs you',
  [EHeaderState.Running]: 'Running',
  [EHeaderState.Idle]: 'Idle',
  [EHeaderState.Unavailable]: 'Activity unavailable',
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
  activityUnavailable?: boolean
}): EHeaderState {
  if (args.failed) return EHeaderState.Failed
  if (args.waitingOnOperator) return EHeaderState.NeedsYou
  if (args.working) return EHeaderState.Running
  return args.activityUnavailable ? EHeaderState.Unavailable : EHeaderState.Idle
}

export function spawnerIdOf(thread: WireThread | undefined): string | undefined {
  return thread?.agent?.spawnedBy
}

export function branchOf(thread: WireThread | undefined): string | undefined {
  const branch = thread?.worktree?.branch
  return branch === undefined || branch === '' ? undefined : branch
}

export const entryHasConflicts = (entry: PullRequestEntry): boolean =>
  entry.mergeable === false && entry.state === EPullRequestStateWire.Open

export function checksTallyOf(entry: PullRequestEntry): ChecksTally | undefined {
  const running = entry.checksRunning ?? 0
  const passed = entry.checksPassed ?? 0
  const failed = entry.checksFailed ?? 0
  if (running + passed + failed === 0) return undefined
  return { running, passed, failed }
}
