import type { ClockPort, ModelUsage, RunId, TelemetryPort, ThreadId } from '@dltech/atlas-core'

import type { TurnLedgerPort } from './turn-ledger.port'

export type TurnLedgerDeps = {
  ledger?: TurnLedgerPort | undefined
  clock?: ClockPort | undefined
  onLedgerFailure?: ((error: unknown) => void) | undefined
  telemetry?: TelemetryPort | undefined
}

export type TurnSpendTally = {
  countStep(usage: ModelUsage | undefined): void
  settle(args: { threadId: ThreadId; runId: RunId; status: string }): Promise<void>
}
