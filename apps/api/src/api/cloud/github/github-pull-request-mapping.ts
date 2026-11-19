import {
  ECheckSource,
  checkRunOutcomeOf,
  checksTally,
  latestCheckAttempts,
  statusContextOutcomeOf,
  type CheckIdentity,
} from '@dltech/atlas-core'

export interface RestPullRequest {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  merged_at: string | null
  updated_at: string
  mergeable: boolean | null
  mergeable_state: string
  head: { ref: string; sha: string; repo: { full_name: string } | null }
  base: { ref: string }
}

export interface RestCheckRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  app?: { slug: string } | null
  html_url?: string | null
  output?: { title?: string | null; summary?: string | null } | null
}

export interface RestCommitStatus {
  id: number
  context: string
  state: string
  created_at: string | null
  updated_at: string | null
  target_url?: string | null
  description?: string | null
}

export interface PullRequestCacheFields {
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  headRepoFullName: string | null
  checksRunning: number
  checksPassed: number
  checksFailed: number
  checksIgnored: number
  mergeable: boolean | null
  mergeClean?: boolean | null
}

/**
 * REST `mergeable` is only "no conflicts"; `mergeable_state` is GitHub's own verdict, and `clean`
 * (or `has_hooks`, which adds no blocker of its own) is the only state a green notice may call a
 * PR mergeable in. Anything else — `blocked` on a required check or a review, `unknown` before
 * GitHub has computed it — stays unsaid.
 */
export function mergeCleanOf(mergeableState: string | null | undefined): boolean {
  return mergeableState === 'clean' || mergeableState === 'has_hooks'
}

export function pullRequestStateOf(pull: RestPullRequest): string {
  if (pull.state === 'open') return pull.draft ? 'draft' : 'open'
  return pull.merged_at === null ? 'closed' : 'merged'
}

export function pullRequestCacheFieldsOf(args: {
  pull: RestPullRequest
  checkRuns: readonly RestCheckRun[]
  statuses: readonly RestCommitStatus[]
}): PullRequestCacheFields {
  const attempts: CheckIdentity[] = [
    ...args.checkRuns.map((run) => ({
      appSlug: run.app?.slug ?? null,
      checkKey: `${ECheckSource.Run}:${run.id}`,
      name: run.name,
      outcome: checkRunOutcomeOf({
        status: run.status,
        conclusion: run.conclusion,
      }),
      source: ECheckSource.Run,
      sourceCreatedAt: run.completed_at ?? run.started_at,
      sourceId: String(run.id),
    })),
    ...args.statuses.map((status) => ({
      appSlug: null,
      checkKey: `${ECheckSource.Status}:${status.context}`,
      name: status.context,
      outcome: statusContextOutcomeOf(status.state),
      source: ECheckSource.Status,
      sourceCreatedAt: status.created_at,
      sourceId: String(status.id),
    })),
  ]
  const tally = checksTally(latestCheckAttempts({ attempts }).map((attempt) => attempt.outcome))

  return {
    title: args.pull.title,
    url: args.pull.html_url,
    state: pullRequestStateOf(args.pull),
    headBranch: args.pull.head.ref,
    headSha: args.pull.head.sha,
    headRepoFullName: args.pull.head.repo?.full_name ?? null,
    checksRunning: tally.running,
    checksPassed: tally.passed,
    checksFailed: tally.failed,
    checksIgnored: tally.ignored,
    mergeable: args.pull.mergeable,
    mergeClean: mergeCleanOf(args.pull.mergeable_state),
  }
}
