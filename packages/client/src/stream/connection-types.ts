import type {
  EStreamSurface,
  StreamClientMessage,
  StreamServerMessage,
} from '@dltech/atlas-protocol'

export const SILENCE_LIMIT_MS = 45_000

export const HANDSHAKE_LIMIT_MS = 10_000

export const BACKOFF_BASE_MS = 500

export const BACKOFF_CAP_MS = 15_000

export enum EStreamConnectionState {
  Connecting = 'connecting',
  Authenticating = 'authenticating',
  Open = 'open',
  Backoff = 'backoff',
  Closed = 'closed',
}

export enum EStreamClosedReason {
  Unauthenticated = 'unauthenticated',
  Requested = 'requested',
}

export enum EConnectionTimer {
  Reconnect = 'reconnect',
  Silence = 'silence',
  Handshake = 'handshake',
}

export type ConnectionState = {
  phase: EStreamConnectionState
  attempt: number
  lastFrameAt: number
  reason: EStreamClosedReason | undefined
  closingCode: number | undefined
  reconnectAfterMs: number | undefined
}

export type ConnectionInput =
  | { type: 'connect' }
  | { type: 'socket-opened'; token: string; surface?: EStreamSurface | undefined }
  | { type: 'token-failed' }
  | { type: 'message'; data: string }
  | { type: 'socket-closed'; code: number }
  | { type: 'timer-fired'; timer: EConnectionTimer }
  | { type: 'close-requested' }
  | { type: 'network-online' }

export type ConnectionEffect =
  | { type: 'openSocket' }
  | { type: 'closeSocket' }
  | { type: 'send'; message: StreamClientMessage }
  | { type: 'schedule'; timer: EConnectionTimer; ms: number }
  | { type: 'cancel'; timer: EConnectionTimer }
  | { type: 'deliver'; message: StreamServerMessage }

export type ConnectionStep = {
  state: ConnectionState
  effects: ConnectionEffect[]
}
