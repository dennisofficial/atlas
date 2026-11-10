export const STREAM_PROTOCOL_VERSION = 3

export const STREAM_PROTOCOL_MIN_VERSION = 1

export const STREAM_SESSION_VIEW_VERSION = 2

export const STREAM_EVENT_TYPES_VERSION = 3

export const STREAM_MAX_CLIENT_FRAME_BYTES = 65_536

export const STREAM_HELLO_TIMEOUT_MS = 5_000

export const STREAM_MAX_SESSION_SUBSCRIPTIONS = 32

export const STREAM_TAIL_EVENTS = 1_000

export const STREAM_PAGE_EVENTS = 200

export enum EStreamClose {
  Unauthenticated = 4401,
  SlowConsumer = 4408,
  GoingAway = 1001,
}

export enum EStreamResetReason {
  Fork = 'fork',
  Ahead = 'ahead',
  TooFarBehind = 'too-far-behind',
}

export enum EStreamClearReason {
  HolderLost = 'holder-lost',
  Lost = 'lost',
}

export enum EStreamErrorCode {
  NotFound = 'not-found',
  ForbiddenLimit = 'forbidden-limit',
  BadFrame = 'bad-frame',
  Internal = 'internal',
}

export enum EStreamBlockKind {
  Text = 'text',
  Reasoning = 'reasoning',
}

export enum EStreamSubscribeKind {
  Session = 'session',
  Sessions = 'sessions',
}

export enum EStreamSurface {
  Web = 'web',
  Desktop = 'desktop',
  Ios = 'ios',
}
