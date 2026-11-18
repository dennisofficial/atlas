import { ECheckOutcome, EChecksState } from './checks'

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

export function rollupOfStoredChecksState(name: string | null): EChecksState | null {
  switch (name) {
    case EStoredChecksState.Success:
      return EChecksState.Passing
    case EStoredChecksState.Failure:
      return EChecksState.Failing
    case EStoredChecksState.Pending:
      return EChecksState.Running
    default:
      return null
  }
}
