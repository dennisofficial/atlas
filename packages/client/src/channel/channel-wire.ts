import { runFailureSchema, toCallId, toRunId } from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcomeWire } from '@dltech/atlas-wire/web'

import type { TurnOutcome } from './turn-outcome'

export {
  bearerSubprotocolOf,
  capabilitySetOf,
  CHANNEL_PROTOCOL_MIN_VERSION,
  CHANNEL_PROTOCOL_VERSION,
  ECapability,
  EProtocolSkew,
  protocolSkewOf,
  supports,
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

export type {
  CapabilitySet,
  ClientFrame,
  ProtocolRange,
  ServeFrame,
  TurnOutcomeWire,
} from '@dltech/atlas-wire/web'

export const turnOutcomeFromWire = (outcome: TurnOutcomeWire): TurnOutcome => {
  if (outcome.status === ETurnStatus.Paused) {
    return { ...outcome, runId: toRunId(outcome.runId), callId: toCallId(outcome.callId) }
  }
  if (outcome.status === ETurnStatus.Failed) {
    const { failure: wireFailure, ...rest } = outcome
    const parsed = runFailureSchema.safeParse(wireFailure)
    return {
      ...rest,
      runId: toRunId(outcome.runId),
      cause: undefined,
      ...(parsed.success ? { failure: parsed.data } : {}),
    }
  }
  return { ...outcome, runId: toRunId(outcome.runId) }
}
