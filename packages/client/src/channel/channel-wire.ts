import { toCallId, toRunId } from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcomeWire } from '@dltech/atlas-wire/web'

import type { TurnOutcome } from './turn-outcome'

export {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  decodeClientFrame,
  decodeServeFrame,
  EClientFrame,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  ETurnStatus,
  toSendId,
  tokenFromSubprotocols,
} from '@dltech/atlas-wire/web'

export type { ClientFrame, ServeFrame, TurnOutcomeWire } from '@dltech/atlas-wire/web'

export const turnOutcomeFromWire = (outcome: TurnOutcomeWire): TurnOutcome => {
  if (outcome.status === ETurnStatus.Paused) {
    return { ...outcome, runId: toRunId(outcome.runId), callId: toCallId(outcome.callId) }
  }
  if (outcome.status === ETurnStatus.Failed) {
    return { ...outcome, runId: toRunId(outcome.runId), cause: undefined }
  }
  return { ...outcome, runId: toRunId(outcome.runId) }
}
