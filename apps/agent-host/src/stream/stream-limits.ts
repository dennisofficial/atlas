export const STREAM_AUTH_RECHECK_MS = 300_000

export const STREAM_MAX_CONNECTIONS_PER_USER = 20

export const STREAM_DRAIN_TIMEOUT_MS = 5_000

export const STREAM_DRAIN_RECONNECT_SPREAD_MS = 5_000

export const STREAM_SOCKET_IDLE_SECONDS = 120

export const STREAM_SOCKET_MAX_PAYLOAD_BYTES = 1_048_576

export enum EStreamServerClose {
  PolicyViolation = 1008,
  MessageTooBig = 1009,
  InternalError = 1011,
}
