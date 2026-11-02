import { ERunFailureKind, type CallId, type Event, type RunId } from '@dltech/atlas-core'

import { TurnFault } from '../model/turn-fault'
import { swallowedReport } from './turn-faults'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'

export type CommittedCall = { callId: CallId; name: string }

export function unsettledCall({
  committed,
  owned,
}: {
  committed: readonly CommittedCall[]
  owned: readonly Event[]
}): CommittedCall | undefined {
  const called = new Set<string>()
  const settled = new Set<string>()
  for (const event of owned) {
    if (event.type === 'tool-called') called.add(event.callId)
    if (event.type === 'tool-result' || event.type === 'tool-denied') settled.add(event.callId)
  }
  return committed.find((call) => !called.has(call.callId) || !settled.has(call.callId))
}

export function idleOrSwallowed({
  swallowed,
  runId,
}: {
  swallowed: CommittedCall | undefined
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
