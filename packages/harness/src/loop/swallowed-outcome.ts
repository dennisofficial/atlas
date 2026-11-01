import { ERunFailureKind, type CallId, type RunId } from '@dltech/atlas-core'

import { TurnFault } from '../model/turn-fault'
import { swallowedReport } from './turn-faults'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'

export function idleOrSwallowed({
  swallowed,
  runId,
}: {
  swallowed: { callId: CallId; name: string } | undefined
  runId: RunId
}): TurnOutcome {
  if (swallowed === undefined) return { status: ETurnStatus.Idle, runId }
  const message = swallowedReport(swallowed)
  return {
    status: ETurnStatus.Failed,
    runId,
    message,
    cause: new TurnFault({
      kind: ERunFailureKind.ToolSettlement,
      message,
      detail: swallowed,
    }),
  }
}
