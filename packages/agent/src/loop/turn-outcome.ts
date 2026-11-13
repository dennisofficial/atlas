import type { CallId, RunFailure, RunId, WaitingForModel } from '@dltech/atlas-core'

export enum ETurnStatus {
  Completed = 'completed',
  Paused = 'paused',
  Idle = 'idle',
  Interrupted = 'interrupted',
  HandoffPaused = 'relocation-paused',
  Failed = 'failed',
  WaitingForModel = 'waiting-for-model',
  Parked = 'parked',
}

export type TurnOutcome =
  | { status: ETurnStatus.Completed; runId: RunId }
  | { status: ETurnStatus.Paused; runId: RunId; callId: CallId; reason: string }
  | { status: ETurnStatus.Idle; runId: RunId }
  | { status: ETurnStatus.Interrupted; runId: RunId; committed: boolean }
  | { status: ETurnStatus.HandoffPaused; runId: RunId }
  | { status: ETurnStatus.WaitingForModel; runId: RunId; waiting: WaitingForModel }
  | { status: ETurnStatus.Parked; runId: RunId; callId: CallId }
  | {
      status: ETurnStatus.Failed
      runId: RunId
      message: string
      cause: unknown
      failure?: RunFailure | undefined
    }
