import {
  EPrEventKind,
  EPullRequestState,
  type Event,
  type JsonValue,
  type SubscriptionEndRules,
  type V2Event,
} from '@dltech/atlas-core'

import { GITHUB_RUN_PROVIDER, runTargetOf } from './run-target'
import { GITHUB_PROVIDER, targetOf } from './target'

const TERMINAL_PR_STATES: readonly string[] = [EPullRequestState.Merged, EPullRequestState.Closed]

const repoKeyOf = (repo: string): string =>
  repo
    .trim()
    .toLowerCase()
    .replace(/^github\.com\//, '')

const endsPullRequest = (args: { target: JsonValue; event: Event | V2Event }): boolean => {
  const { event } = args
  if (event.type !== 'pr-event') return false
  if (event.kind !== EPrEventKind.State) return false
  if (!TERMINAL_PR_STATES.includes(event.state ?? '')) return false
  const target = targetOf(args.target)
  if (target === null) return false
  return target.number === event.prNumber && repoKeyOf(target.repo) === repoKeyOf(event.repo)
}

const endsPinnedRun = (args: { target: JsonValue; event: Event | V2Event }): boolean => {
  const { event } = args
  if (event.type !== 'run-event') return false
  const target = runTargetOf(args.target)
  if (target === null || target.kind !== 'run') return false
  return target.runId === event.workflowRunId && repoKeyOf(target.repo) === repoKeyOf(event.repo)
}

export const githubSubscriptionEnds: SubscriptionEndRules = Object.freeze({
  [GITHUB_PROVIDER]: endsPullRequest,
  [GITHUB_RUN_PROVIDER]: endsPinnedRun,
})
