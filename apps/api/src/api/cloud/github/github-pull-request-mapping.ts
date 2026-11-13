import {
  checkRunOutcomeOf,
  checksTally,
  latestAttemptOutcomes,
  statusContextOutcomeOf,
  type CheckAttempt,
} from '@dltech/atlas-core'

export interface RestPullRequest {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  merged_at: string | null
  mergeable: boolean | null
  mergeable_state: string
  head: { ref: string; sha: string; repo: { full_name: string } | null }
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
  checksState: string | null
  mergeable: boolean | null
}

export function pullRequestStateOf(pull: RestPullRequest): string {
  if (pull.state === 'open') return pull.draft ? 'draft' : 'open'
  return pull.merged_at === null ? 'closed' : 'merged'
}

export function pullRequestCacheFieldsOf(args: {
  pull: RestPullRequest
  checkRuns: readonly RestCheckRun[]
  statuses: readonly RestCommitStatus[]
  checksState: string | null
}): PullRequestCacheFields {
  const latestByContext = new Map<string, RestCommitStatus>()
  for (const status of args.statuses) {
    if (!latestByContext.has(status.context)) latestByContext.set(status.context, status)
  }
  const attempts: CheckAttempt[] = [
    ...args.checkRuns.map((run) => ({
      name: run.name,
      order: run.id,
      outcome: checkRunOutcomeOf({
        status: run.status,
        conclusion: run.conclusion,
      }),
    })),
    ...[...latestByContext.values()].map((status) => ({
      name: status.context,
      order: null,
      outcome: statusContextOutcomeOf(status.state),
    })),
  ]
  const tally = checksTally(latestAttemptOutcomes(attempts))

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
    checksState: args.checksState,
    mergeable: args.pull.mergeable,
  }
}
