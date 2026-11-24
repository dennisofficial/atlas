import {
  pullRequestChecksTallyOf,
  pullRequestHasConflicts,
  pullRequestIsSettled,
  type PullRequestChecksTally,
  type PullRequestFacts,
} from '@dltech/atlas-plugin-github/core'
import type { WireThread } from '@dltech/atlas-wire/web'

import type { PullRequestEntry } from './pull-request-entries'

export enum EHeaderState {
  Failed = 'failed',
  NeedsYou = 'needs-you',
  Running = 'running',
  Idle = 'idle',
}

export type ChecksTally = PullRequestChecksTally

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

export function currentBranchOf(thread: WireThread | undefined): string | undefined {
  const checkout = thread?.checkout
  if (checkout) {
    if (checkout.detached) return 'detached'
    return checkout.branch || undefined
  }
  return thread?.worktree?.branch || undefined
}

export const isOutsideGit = (thread: WireThread | undefined): boolean =>
  thread?.checkout !== undefined && !thread.checkout.detached && !thread.checkout.branch

export const pullRequestFactsOf = (entry: PullRequestEntry): PullRequestFacts => ({
  state: entry.state,
  checksState: entry.checksState,
  mergeable: entry.mergeable,
  mergeQueued: entry.mergeQueued,
  autoMerge: entry.autoMerge,
  checks: {
    running: entry.checksRunning,
    passed: entry.checksPassed,
    failed: entry.checksFailed,
    expected: entry.checksExpected,
  },
})

export const entryHasConflicts = (entry: PullRequestEntry): boolean =>
  pullRequestHasConflicts(pullRequestFactsOf(entry))

export const entryIsSettled = (entry: PullRequestEntry): boolean =>
  pullRequestIsSettled(pullRequestFactsOf(entry))

export function checksTallyOf(entry: PullRequestEntry): ChecksTally | undefined {
  return pullRequestChecksTallyOf(pullRequestFactsOf(entry))
}
