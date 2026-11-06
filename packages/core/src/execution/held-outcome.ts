export enum EHeldOutcome {
  Idle = 'idle',
  Faulted = 'faulted',
  StartFailed = 'start-failed',
  GaveUp = 'gave-up',
  Drained = 'drained',
  Fenced = 'fenced',
}

export type HeldOutcome = { kind: EHeldOutcome; needsHolder: boolean }

export type SettleWrite =
  | { kind: 'none' }
  | { kind: 'revoke'; wantsHolder: boolean; resetRetry: boolean; retryDue: boolean }

export const settleWrite = (outcome: HeldOutcome): SettleWrite => {
  switch (outcome.kind) {
    case EHeldOutcome.Fenced:
      return { kind: 'none' }
    case EHeldOutcome.Idle:
    case EHeldOutcome.Drained:
      return {
        kind: 'revoke',
        wantsHolder: outcome.needsHolder,
        resetRetry: true,
        retryDue: false,
      }
    case EHeldOutcome.StartFailed:
    case EHeldOutcome.Faulted:
      return { kind: 'revoke', wantsHolder: true, resetRetry: false, retryDue: true }
    case EHeldOutcome.GaveUp:
      return { kind: 'revoke', wantsHolder: false, resetRetry: true, retryDue: false }
  }
}
