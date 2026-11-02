export enum EChecksState {
  None = 'none',
  Running = 'running',
  Passing = 'passing',
  Failing = 'failing',
}

export type ChecksTally = { running: number; passed: number; failed: number }

export type ChecksCount = ChecksTally & { ignored: number }

export const NO_CHECKS: ChecksTally = { running: 0, passed: 0, failed: 0 }

export enum ECheckOutcome {
  Passed = 'passed',
  Failed = 'failed',
  Running = 'running',
  Ignored = 'ignored',
}

/**
 * Failing outranks running deliberately: a red check is already true, and waiting will not turn it
 * green.
 */
export function checksRollup(outcomes: readonly ECheckOutcome[]): EChecksState {
  if (outcomes.includes(ECheckOutcome.Failed)) return EChecksState.Failing
  if (outcomes.includes(ECheckOutcome.Running)) return EChecksState.Running
  if (outcomes.includes(ECheckOutcome.Passed)) return EChecksState.Passing

  return EChecksState.None
}

export type CheckAttempt = {
  name: string | null
  startedAt: string | null
  outcome: ECheckOutcome
}

/**
 * GitHub's merge box groups the rollup by check name and shows only the newest attempt: pushing
 * again cancels the in-flight run, and that cancelled entry stays in statusCheckRollup next to its
 * successful re-run. Keeping the latest attempt per name matches the box. An attempt without a
 * name or a timestamp cannot be ordered, and attempts tied on startedAt cannot be ranked, so those
 * all survive rather than being ordered by guesswork — the doubt resolves towards alarming.
 */
export function latestAttemptOutcomes(attempts: readonly CheckAttempt[]): ECheckOutcome[] {
  const byName = new Map<string, CheckAttempt[]>()
  const kept: CheckAttempt[] = []

  for (const attempt of attempts) {
    if (attempt.name === null || attempt.startedAt === null) {
      kept.push(attempt)
      continue
    }
    byName.set(attempt.name, [...(byName.get(attempt.name) ?? []), attempt])
  }

  for (const group of byName.values()) {
    const newest = group.reduce((max, attempt) =>
      (attempt.startedAt ?? '') > (max.startedAt ?? '') ? attempt : max,
    )
    kept.push(...group.filter((attempt) => attempt.startedAt === newest.startedAt))
  }

  return kept.map((attempt) => attempt.outcome)
}

export function checksTally(outcomes: readonly ECheckOutcome[]): ChecksCount {
  return outcomes.reduce<ChecksCount>(
    (tally, outcome) => ({
      running: tally.running + (outcome === ECheckOutcome.Running ? 1 : 0),
      passed: tally.passed + (outcome === ECheckOutcome.Passed ? 1 : 0),
      failed: tally.failed + (outcome === ECheckOutcome.Failed ? 1 : 0),
      ignored: tally.ignored + (outcome === ECheckOutcome.Ignored ? 1 : 0),
    }),
    { ...NO_CHECKS, ignored: 0 },
  )
}

const CHECK_RUN_CONCLUSIONS: Record<string, ECheckOutcome> = {
  success: ECheckOutcome.Passed,
  neutral: ECheckOutcome.Ignored,
  skipped: ECheckOutcome.Ignored,
  stale: ECheckOutcome.Ignored,
  failure: ECheckOutcome.Failed,
  timed_out: ECheckOutcome.Failed,
  startup_failure: ECheckOutcome.Failed,
  action_required: ECheckOutcome.Failed,
  cancelled: ECheckOutcome.Failed,
}

const STATUS_CONTEXT_STATES: Record<string, ECheckOutcome> = {
  success: ECheckOutcome.Passed,
  pending: ECheckOutcome.Running,
  expected: ECheckOutcome.Running,
  failure: ECheckOutcome.Failed,
  error: ECheckOutcome.Failed,
}

export function checkRunOutcomeOf(args: {
  status: string
  conclusion: string | null
}): ECheckOutcome {
  if (args.status.toLowerCase() !== 'completed') return ECheckOutcome.Running

  return CHECK_RUN_CONCLUSIONS[(args.conclusion ?? '').toLowerCase()] ?? ECheckOutcome.Ignored
}

export function statusContextOutcomeOf(state: string): ECheckOutcome {
  return STATUS_CONTEXT_STATES[state.toLowerCase()] ?? ECheckOutcome.Ignored
}
