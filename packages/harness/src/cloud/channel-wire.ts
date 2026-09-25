import { toCallId, toRunId } from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcomeWire } from '@dltech/atlas-wire'

import type { TurnOutcome } from '../loop/turn-outcome'

export {
  bearerSubprotocolOf,
  channelSignalSchema,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  chunkWireSchema,
  clientFrameSchema,
  decodeClientFrame,
  decodeServeFrame,
  EClientFrame,
  EClientRequest,
  EFinishReason,
  ERetryReason,
  EServeEnv,
  EServeFrame,
  ETurnStatus,
  encodeFrame,
  publishedWorkspaceWireSchema,
  rewindApplyParamsSchema,
  rewindCutWireSchema,
  rewindKillWireSchema,
  serveFrameSchema,
  SERVE_BINARY_PATH,
  SERVE_BINARY_SHA256_HEADER,
  SERVE_HEADERS_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_NEXT_BINARY_PATH,
  SERVE_STAMP_PATH,
  SERVE_TOKEN_PATH,
  StaleSandboxTokenError,
  tokenFromSubprotocols,
  turnOutcomeWireSchema,
  wireEventSchema,
  wireThreadSchema,
  wireTurnSchema,
} from '@dltech/atlas-wire'

export type {
  ClientFrame,
  PublishedWorkspaceWire,
  RewindApplyParams,
  RewindCutWire,
  RewindKillWire,
  SaidImageWire,
  ServeFrame,
  TurnOutcomeWire,
  WireDraft,
  WireEvent,
  WireThread,
  WireTurn,
} from '@dltech/atlas-wire'

export const turnOutcomeFromWire = (outcome: TurnOutcomeWire): TurnOutcome => {
  if (outcome.status === ETurnStatus.Paused) {
    return { ...outcome, runId: toRunId(outcome.runId), callId: toCallId(outcome.callId) }
  }
  if (outcome.status === ETurnStatus.Failed) {
    return { ...outcome, runId: toRunId(outcome.runId), cause: undefined }
  }
  return { ...outcome, runId: toRunId(outcome.runId) }
}
