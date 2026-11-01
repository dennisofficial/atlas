import type { CallId, RunFailure, RunId, WaitingForModel } from '@dltech/atlas-core'

export { ETurnStatus } from '@dltech/atlas-wire/web'

import { ETurnStatus } from '@dltech/atlas-wire/web'

export type TurnOutcome =
  | { status: ETurnStatus.Completed; runId: RunId }
  | { status: ETurnStatus.Paused; runId: RunId; callId: CallId; reason: string }
  | { status: ETurnStatus.Idle; runId: RunId }
  | { status: ETurnStatus.Interrupted; runId: RunId; committed: boolean }
  | { status: ETurnStatus.RelocationPaused; runId: RunId }
  | { status: ETurnStatus.WaitingForModel; runId: RunId; waiting: WaitingForModel }
  | {
      status: ETurnStatus.Failed
      runId: RunId
      message: string
      cause: unknown
      failure?: RunFailure | undefined
    }
