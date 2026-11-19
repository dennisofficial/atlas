export const BACKOFF_BASE_MS = 500

export const BACKOFF_CAP_MS = 15_000

export const STABLE_AFTER_MS = 10_000

export enum EStreamConnectionState {
  Connecting = 'connecting',
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
  Stable = 'stable',
}

export type ConnectionState = {
  phase: EStreamConnectionState
  attempt: number
  failures: number
  reason: EStreamClosedReason | undefined
  reconnectAfterMs: number | undefined
}

export type ConnectionInput =
  | { type: 'connect' }
  | { type: 'opened' }
  | { type: 'going-away'; reconnectAfterMs: number }
  | { type: 'ended' }
  | { type: 'failure'; status: number | undefined }
  | { type: 'timer-fired'; timer: EConnectionTimer }
  | { type: 'close-requested' }
  | { type: 'network-online' }
  | { type: 'reconnect-requested' }

export type ConnectionEffect =
  | { type: 'subscribe' }
  | { type: 'abort' }
  | { type: 'schedule'; timer: EConnectionTimer; ms: number }
  | { type: 'cancel'; timer: EConnectionTimer }

export type ConnectionStep = {
  state: ConnectionState
  effects: ConnectionEffect[]
}
