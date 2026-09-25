import type { CallId, RunId } from '@dltech/atlas-core'

export { ETurnStatus } from '@dltech/atlas-wire'

import { ETurnStatus } from '@dltech/atlas-wire'

export type TurnOutcome =
  | { status: ETurnStatus.Completed; runId: RunId }
  | { status: ETurnStatus.Paused; runId: RunId; callId: CallId; reason: string }
  | { status: ETurnStatus.Idle; runId: RunId }
  | { status: ETurnStatus.Interrupted; runId: RunId; committed: boolean }
  | { status: ETurnStatus.Failed; runId: RunId; message: string; cause: unknown }
