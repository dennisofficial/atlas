import {
  EStreamClose,
  parseServerMessage,
  STREAM_PROTOCOL_VERSION,
  type EStreamSurface,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  type ConnectionEffect,
  type ConnectionInput,
  type ConnectionState,
  type ConnectionStep,
  EConnectionTimer,
  EStreamClosedReason,
  EStreamConnectionState,
  HANDSHAKE_LIMIT_MS,
  SILENCE_LIMIT_MS,
} from './connection-types'

export * from './connection-types'

type ReduceArgs = {
  state: ConnectionState
  input: ConnectionInput
  now: number
  random: number
}

export const initialConnectionState = (): ConnectionState => ({
  phase: EStreamConnectionState.Closed,
  attempt: 0,
  lastFrameAt: 0,
  reason: undefined,
  closingCode: undefined,
  reconnectAfterMs: undefined,
})

export const backoffDelayMs = (args: { attempt: number; random: number }): number =>
  Math.floor(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** args.attempt) * args.random)

const stay = (state: ConnectionState): ConnectionStep => ({
  state,
  effects: [],
})

const startHandshake: ConnectionEffect[] = [
  { type: 'openSocket' },
  {
    type: 'schedule',
    timer: EConnectionTimer.Handshake,
    ms: HANDSHAKE_LIMIT_MS,
  },
]

const cancelHandshake: ConnectionEffect = {
  type: 'cancel',
  timer: EConnectionTimer.Handshake,
}

const hasSocket = (state: ConnectionState): boolean =>
  state.phase === EStreamConnectionState.Connecting ||
  state.phase === EStreamConnectionState.Authenticating ||
  state.phase === EStreamConnectionState.Open

const toBackoff = (args: {
  state: ConnectionState
  random: number
  effects?: ConnectionEffect[]
}): ConnectionStep => {
  const { state, random } = args
  const directed = state.reconnectAfterMs
  const ms = directed ?? backoffDelayMs({ attempt: state.attempt, random })
  return {
    state: {
      ...state,
      phase: EStreamConnectionState.Backoff,
      attempt: directed === undefined ? state.attempt + 1 : state.attempt,
      closingCode: undefined,
      reconnectAfterMs: undefined,
    },
    effects: [...(args.effects ?? []), { type: 'schedule', timer: EConnectionTimer.Reconnect, ms }],
  }
}

const toClosed = (args: {
  state: ConnectionState
  reason: EStreamClosedReason
}): ConnectionStep => ({
  state: {
    ...args.state,
    phase: EStreamConnectionState.Closed,
    reason: args.reason,
    closingCode: undefined,
    reconnectAfterMs: undefined,
  },
  effects: [{ type: 'cancel', timer: EConnectionTimer.Silence }, cancelHandshake],
})

const connect = (state: ConnectionState): ConnectionStep => {
  if (state.phase !== EStreamConnectionState.Closed) return stay(state)
  return {
    state: {
      ...state,
      phase: EStreamConnectionState.Connecting,
      attempt: 0,
      reason: undefined,
    },
    effects: startHandshake,
  }
}

const socketOpened = (args: {
  state: ConnectionState
  token: string
  surface?: EStreamSurface | undefined
}): ConnectionStep => {
  if (args.state.phase !== EStreamConnectionState.Connecting) return stay(args.state)
  return {
    state: { ...args.state, phase: EStreamConnectionState.Authenticating },
    effects: [
      {
        type: 'send',
        message: {
          type: 'hello',
          v: STREAM_PROTOCOL_VERSION,
          token: args.token,
          ...(args.surface === undefined ? {} : { surface: args.surface }),
        },
      },
    ],
  }
}

const socketClosed = (args: { state: ConnectionState; code: number; random: number }) => {
  const { state } = args
  if (!hasSocket(state)) return stay(state)
  const code = state.closingCode ?? args.code
  if (code === EStreamClose.Unauthenticated) {
    return toClosed({ state, reason: EStreamClosedReason.Unauthenticated })
  }
  return toBackoff({
    state,
    random: args.random,
    effects: [{ type: 'cancel', timer: EConnectionTimer.Silence }, cancelHandshake],
  })
}

const handleReady = (args: {
  state: ConnectionState
  message: StreamServerMessage
  now: number
}) => ({
  state: {
    ...args.state,
    phase: EStreamConnectionState.Open,
    attempt: 0,
    lastFrameAt: args.now,
  },
  effects: [
    cancelHandshake,
    { type: 'schedule', timer: EConnectionTimer.Silence, ms: SILENCE_LIMIT_MS },
    { type: 'deliver', message: args.message },
  ] satisfies ConnectionEffect[],
})

const parseFrame = (data: string): StreamServerMessage | undefined => {
  try {
    const parsed = parseServerMessage(JSON.parse(data))
    return parsed.ok ? parsed.message : undefined
  } catch {
    return undefined
  }
}

const receive = (args: { state: ConnectionState; data: string; now: number }): ConnectionStep => {
  const { state, now } = args
  const authenticating = state.phase === EStreamConnectionState.Authenticating
  if (!authenticating && state.phase !== EStreamConnectionState.Open) return stay(state)
  const seen = { ...state, lastFrameAt: now }
  const message = parseFrame(args.data)
  if (message === undefined || message.type === 'pong') return stay(seen)
  if (message.type === 'closing') return stay({ ...seen, closingCode: message.code })
  if (message.type === 'going-away') {
    return stay({ ...seen, reconnectAfterMs: message.reconnectAfterMs })
  }
  if (authenticating) {
    return message.type === 'ready' ? handleReady({ state: seen, message, now }) : stay(seen)
  }
  if (message.type === 'ready') return stay(seen)
  return { state: seen, effects: [{ type: 'deliver', message }] }
}

const isAuthenticating = (state: ConnectionState): boolean =>
  state.phase === EStreamConnectionState.Authenticating

const networkOnline = (state: ConnectionState): ConnectionStep => {
  if (state.phase !== EStreamConnectionState.Backoff) return stay(state)
  return {
    state: { ...state, phase: EStreamConnectionState.Connecting, attempt: 0 },
    effects: [{ type: 'cancel', timer: EConnectionTimer.Reconnect }, ...startHandshake],
  }
}

const timerFired = (args: ReduceArgs & { timer: EConnectionTimer }): ConnectionStep => {
  const { state, now, timer } = args
  if (timer === EConnectionTimer.Reconnect) {
    if (state.phase !== EStreamConnectionState.Backoff) return stay(state)
    return {
      state: { ...state, phase: EStreamConnectionState.Connecting },
      effects: startHandshake,
    }
  }
  if (timer === EConnectionTimer.Handshake) {
    if (state.phase !== EStreamConnectionState.Connecting && !isAuthenticating(state)) {
      return stay(state)
    }
    return toBackoff({
      state,
      random: args.random,
      effects: [{ type: 'closeSocket' }],
    })
  }
  if (state.phase !== EStreamConnectionState.Open) return stay(state)
  const silentFor = now - state.lastFrameAt
  if (silentFor < SILENCE_LIMIT_MS) {
    const effect = {
      type: 'schedule',
      timer,
      ms: SILENCE_LIMIT_MS - silentFor,
    } as const
    return { state, effects: [effect] }
  }
  return toBackoff({
    state,
    random: args.random,
    effects: [{ type: 'closeSocket' }],
  })
}

const closeRequested = (state: ConnectionState): ConnectionStep => {
  if (state.phase === EStreamConnectionState.Closed) return stay(state)
  const closed = toClosed({ state, reason: EStreamClosedReason.Requested })
  return {
    state: closed.state,
    effects: [
      { type: 'closeSocket' },
      { type: 'cancel', timer: EConnectionTimer.Reconnect },
      ...closed.effects,
    ],
  }
}

export const reduceConnection = (args: ReduceArgs): ConnectionStep => {
  const { state, input, now, random } = args
  switch (input.type) {
    case 'connect':
      return connect(state)
    case 'socket-opened':
      return socketOpened({ state, token: input.token })
    case 'token-failed':
      if (state.phase !== EStreamConnectionState.Connecting) return stay(state)
      return toBackoff({
        state,
        random,
        effects: [{ type: 'closeSocket' }, cancelHandshake],
      })
    case 'message':
      return receive({ state, data: input.data, now })
    case 'socket-closed':
      return socketClosed({ state, code: input.code, random })
    case 'timer-fired':
      return timerFired({ ...args, timer: input.timer })
    case 'close-requested':
      return closeRequested(state)
    case 'network-online':
      return networkOnline(state)
  }
}
