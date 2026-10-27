import type { WireThread } from '@dltech/atlas-wire/web'

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
