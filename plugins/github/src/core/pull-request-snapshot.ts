import type { ChecksCount, SubscriptionSnapshot } from '@dltech/atlas-core'

const SHORT_SHA_LENGTH = 7
const FAILURE_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure'])

export enum EReviewDecision {
  Approved = 'approved',
  ChangesRequested = 'changes requested',
}

export type PullRequestChecks = { tally: ChecksCount; failedNames: readonly string[] }

export type PullRequestReview = { author: string; state: string }

export type WorkflowRunJob = {
  name: string
  status?: string | undefined
  conclusion?: string | null | undefined
}

export type PullRequestSnapshotInput = {
  draft: boolean
  headSha: string | null
  mergeable: boolean | null
  baseBranch: string | null
  checks?: PullRequestChecks | undefined
  pendingSuites?: number | undefined
  missingRequired?: readonly string[] | undefined
  reviews?: readonly PullRequestReview[] | undefined
}

export const reviewDecisionOf = (
  reviews: readonly PullRequestReview[],
): EReviewDecision | undefined => {
  const latestByAuthor = new Map<string, string>()
  for (const review of reviews) latestByAuthor.set(review.author, review.state.toUpperCase())
  const states = [...latestByAuthor.values()]
  if (states.includes('CHANGES_REQUESTED')) return EReviewDecision.ChangesRequested
  if (states.includes('APPROVED')) return EReviewDecision.Approved
  return undefined
}

const reportedChecks = (tally: ChecksCount): number => tally.passed + tally.failed + tally.running

const tallyPhrase = (tally: ChecksCount): string =>
  `(${tally.passed} passed, ${tally.failed} failed, ${tally.running} running)`

const failedNamesPhrase = (names: readonly string[]): string =>
  names.length === 0 ? '' : `: ${names.join(', ')}`

const waitingPhrase = (missing: readonly string[]): string =>
  missing.length === 0 ? '' : `, waiting for required ${missing.join(', ')} to report`

const runningFactOf = (input: PullRequestSnapshotInput, checks: PullRequestChecks): string =>
  `CI is still running ${tallyPhrase(checks.tally)}${failedNamesPhrase(checks.failedNames)}${waitingPhrase(input.missingRequired ?? [])}`

const settledFactOf = (checks: PullRequestChecks): string => {
  const tally = tallyPhrase(checks.tally)
  const failed = failedNamesPhrase(checks.failedNames)
  if (checks.tally.failed > 0) {
    const count =
      checks.tally.failed === 1 ? 'a check failed' : `${checks.tally.failed} checks failed`
    return `CI finished, ${count} ${tally}${failed}`
  }
  return `CI finished, all checks passed ${tally}`
}

const checksRunning = (input: PullRequestSnapshotInput): boolean =>
  (input.pendingSuites ?? 0) > 0 ||
  (input.checks?.tally.running ?? 0) > 0 ||
  (input.missingRequired ?? []).length > 0

const checksFactOf = (input: PullRequestSnapshotInput): string | undefined => {
  const { checks } = input
  if (checks === undefined) return undefined
  if (checksRunning(input)) return runningFactOf(input, checks)
  if (reportedChecks(checks.tally) === 0) return undefined
  return settledFactOf(checks)
}

const nextOf = (input: PullRequestSnapshotInput): string => {
  const settled =
    'The next notices are a new push, CI starting again, a comment or review, or a merge or close.'
  const { checks } = input
  if (checks === undefined) return `CI state is not known now. ${settled}`
  if (checksRunning(input)) return 'A CI notice follows when it settles.'
  if (reportedChecks(checks.tally) === 0) {
    return 'No checks are reported for this head yet. If CI starts on it, a CI notice follows when it settles.'
  }
  if (input.pendingSuites === undefined) return `CI state is not known now. ${settled}`
  return `No CI notice comes for this head. ${settled}`
}

const headFactOf = (input: PullRequestSnapshotInput): string | undefined => {
  if (input.headSha === null || input.headSha.length < SHORT_SHA_LENGTH) return undefined
  const readiness = input.draft ? 'draft' : 'ready for review'
  return `${readiness}, head ${input.headSha.slice(0, SHORT_SHA_LENGTH)}`
}

const mergeabilityFactOf = (input: PullRequestSnapshotInput): string => {
  if (input.mergeable === true) return 'mergeable'
  if (input.mergeable === false) {
    return input.baseBranch === null
      ? 'has merge conflicts'
      : `has merge conflicts with ${input.baseBranch}`
  }
  return 'mergeability not known yet'
}

const reviewFactOf = (reviews: readonly PullRequestReview[] | undefined): string | undefined => {
  const decision = reviewDecisionOf(reviews ?? [])
  return decision === undefined ? undefined : `review ${decision}`
}

export const pullRequestSnapshotOf = (input: PullRequestSnapshotInput): SubscriptionSnapshot => {
  const facts = [
    headFactOf(input),
    checksFactOf(input),
    mergeabilityFactOf(input),
    reviewFactOf(input.reviews),
  ].filter((fact): fact is string => fact !== undefined)
  return { facts, next: nextOf(input) }
}

const jobFailed = (job: WorkflowRunJob): boolean =>
  job.conclusion !== null && job.conclusion !== undefined && FAILURE_CONCLUSIONS.has(job.conclusion)

const jobsFactOf = (jobs: readonly WorkflowRunJob[]): string => {
  if (jobs.length === 0) return 'no jobs have started yet'
  const finished = jobs.filter((job) => job.status === 'completed').length
  const failed = jobs.filter(jobFailed).map((job) => job.name)
  const lead = `${finished} of ${jobs.length} jobs finished`
  return failed.length === 0 ? lead : `${lead}, ${failed.length} failed${failedNamesPhrase(failed)}`
}

export const runSnapshotOf = (
  jobs: readonly WorkflowRunJob[] | undefined,
): SubscriptionSnapshot => ({
  facts: jobs === undefined ? [] : [jobsFactOf(jobs)],
  next: 'A notice arrives when the run finishes.',
})
