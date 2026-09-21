export interface RestPullRequest {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  merged_at: string | null
  mergeable: boolean | null
  mergeable_state: string
  head: { ref: string; sha: string }
}

export interface RestCheckRun {
  status: string
  conclusion: string | null
}

export interface RestCommitStatus {
  context: string
  state: string
}

export interface PullRequestCacheFields {
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  mergeableState: string | null
}

const RUNNING_CONCLUSIONS = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])
const PASSED_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const FAILED_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
])

function tallyCheckRun(tally: { running: number; passed: number; failed: number }, run: RestCheckRun): void {
  if (run.status !== 'completed' || RUNNING_CONCLUSIONS.has(run.status)) {
    tally.running += 1
    return
  }
  if (run.conclusion !== null && PASSED_CONCLUSIONS.has(run.conclusion)) {
    tally.passed += 1
    return
  }
  if (run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion)) {
    tally.failed += 1
  }
}

function tallyCommitStatus(
  tally: { running: number; passed: number; failed: number },
  status: RestCommitStatus,
): void {
  if (status.state === 'pending') {
    tally.running += 1
    return
  }
  if (status.state === 'success') {
    tally.passed += 1
    return
  }
  if (status.state === 'failure' || status.state === 'error') tally.failed += 1
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
  const tally = { running: 0, passed: 0, failed: 0 }
  for (const run of args.checkRuns) tallyCheckRun(tally, run)

  const latestByContext = new Map<string, RestCommitStatus>()
  for (const status of args.statuses) {
    if (!latestByContext.has(status.context)) latestByContext.set(status.context, status)
  }
  for (const status of latestByContext.values()) tallyCommitStatus(tally, status)

  return {
    title: args.pull.title,
    url: args.pull.html_url,
    state: pullRequestStateOf(args.pull),
    headBranch: args.pull.head.ref,
    headSha: args.pull.head.sha,
    checksRunning: tally.running,
    checksPassed: tally.passed,
    checksFailed: tally.failed,
    mergeable: args.pull.mergeable,
    mergeableState: args.pull.mergeable_state,
  }
}
