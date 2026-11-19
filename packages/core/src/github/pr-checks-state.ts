import { ECheckOutcome, checksRollupOfCounts, type ChecksCount } from './checks'
import type { PrChecksSummary } from './pr-fold-state'

export enum EStoredChecksState {
  Expected = 'expected',
  Failure = 'failure',
  Pending = 'pending',
  Success = 'success',
}

export function missingRequiredContextsOf(args: {
  requiredContexts: readonly string[]
  reportedContexts: readonly string[]
}): string[] {
  const reported = new Set(args.reportedContexts)

  return args.requiredContexts.filter((context) => !reported.has(context))
}

/**
 * The stored column feeds the client's own vocabulary, where a required check GitHub has not
 * reported yet reads as `expected` — the header's "waiting" state — and the tally reads as its
 * settled outcomes. Failing outranks running for the same reason `checksRollup` says so.
 */
export function storedChecksStateOf(args: {
  outcomes: readonly ECheckOutcome[]
  missingRequiredContexts: readonly string[]
}): EStoredChecksState | null {
  if (args.outcomes.includes(ECheckOutcome.Failed)) return EStoredChecksState.Failure
  if (args.outcomes.includes(ECheckOutcome.Running)) return EStoredChecksState.Pending
  if (args.missingRequiredContexts.length > 0) return EStoredChecksState.Expected
  if (args.outcomes.length === 0) return null

  return EStoredChecksState.Success
}

export function checksSummaryOfStored(args: {
  checksState: EStoredChecksState | null
  counts: ChecksCount
  headSha: string
}): PrChecksSummary | null {
  if (args.checksState === null) return null
  const rollup = checksRollupOfCounts(args.counts)
  if (rollup === null) return null

  return { headSha: args.headSha, ...args.counts, rollup }
}
