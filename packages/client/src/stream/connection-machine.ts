import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  EConnectionTimer,
  EStreamClosedReason,
  EStreamConnectionState,
  STABLE_AFTER_MS,
  type ConnectionEffect,
  type ConnectionInput,
  type ConnectionState,
  type ConnectionStep,
} from './connection-types'

export * from './connection-types'

type ReduceArgs = {
  state: ConnectionState
  input: ConnectionInput
  random: number
}

export const initialConnectionState = (): ConnectionState => ({
  phase: EStreamConnectionState.Closed,
  attempt: 0,
  failures: 0,
  reason: undefined,
  reconnectAfterMs: undefined,
})

export const backoffDelayMs = (args: { attempt: number; random: number }): number =>
  Math.floor(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** args.attempt) * args.random)

const stay = (state: ConnectionState): ConnectionStep => ({ state, effects: [] })

const subscribe: ConnectionEffect = { type: 'subscribe' }

const abort: ConnectionEffect = { type: 'abort' }

const cancelReconnect: ConnectionEffect = { type: 'cancel', timer: EConnectionTimer.Reconnect }

const cancelStable: ConnectionEffect = { type: 'cancel', timer: EConnectionTimer.Stable }

const toBackoff = (args: {
  state: ConnectionState
  random: number
  reconnectAfterMs?: number | undefined
}): ConnectionStep => {
  const directed = args.reconnectAfterMs ?? args.state.reconnectAfterMs
  const ms = directed ?? backoffDelayMs({ attempt: args.state.attempt, random: args.random })
  return {
    state: {
      ...args.state,
      phase: EStreamConnectionState.Backoff,
      attempt: directed === undefined ? args.state.attempt + 1 : args.state.attempt,
      reconnectAfterMs: undefined,
    },
    effects: [abort, cancelStable, { type: 'schedule', timer: EConnectionTimer.Reconnect, ms }],
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
    reconnectAfterMs: undefined,
  },
  effects: [abort, cancelReconnect, cancelStable],
})

const connect = (state: ConnectionState): ConnectionStep => {
  if (state.phase !== EStreamConnectionState.Closed) return stay(state)
  return {
    state: {
      ...state,
      phase: EStreamConnectionState.Connecting,
      attempt: 0,
      failures: 0,
      reason: undefined,
    },
    effects: [subscribe],
  }
}

const opened = (state: ConnectionState): ConnectionStep => {
  if (state.phase === EStreamConnectionState.Closed) return stay(state)
  const settled =
    state.phase === EStreamConnectionState.Open && state.reconnectAfterMs === undefined
  if (settled) return stay(state)
  return {
    state: {
      ...state,
      phase: EStreamConnectionState.Open,
      reason: undefined,
      reconnectAfterMs: undefined,
    },
    effects: [{ type: 'schedule', timer: EConnectionTimer.Stable, ms: STABLE_AFTER_MS }],
  }
}

const goingAway = (args: { state: ConnectionState; reconnectAfterMs: number }): ConnectionStep => {
  if (args.state.phase === EStreamConnectionState.Closed) return stay(args.state)
  return stay({ ...args.state, reconnectAfterMs: args.reconnectAfterMs })
}

const ended = (args: { state: ConnectionState; random: number }): ConnectionStep => {
  if (args.state.phase === EStreamConnectionState.Closed) return stay(args.state)
  return toBackoff(args)
}

const failed = (args: {
  state: ConnectionState
  status: number | undefined
  random: number
}): ConnectionStep => {
  if (args.state.phase === EStreamConnectionState.Closed) return stay(args.state)
  if (args.status === 401) {
    return toClosed({ state: args.state, reason: EStreamClosedReason.Unauthenticated })
  }
  return toBackoff({
    state: { ...args.state, failures: args.state.failures + 1 },
    random: args.random,
  })
}

const timerFired = (args: ReduceArgs & { timer: EConnectionTimer }): ConnectionStep => {
  if (args.timer === EConnectionTimer.Stable) {
    if (args.state.phase !== EStreamConnectionState.Open) return stay(args.state)
    return stay({ ...args.state, attempt: 0, failures: 0 })
  }
  if (args.state.phase !== EStreamConnectionState.Backoff) return stay(args.state)
  return {
    state: { ...args.state, phase: EStreamConnectionState.Connecting },
    effects: [subscribe],
  }
}

const closeRequested = (state: ConnectionState): ConnectionStep => {
  if (state.phase === EStreamConnectionState.Closed) return stay(state)
  return toClosed({ state, reason: EStreamClosedReason.Requested })
}

const networkOnline = (state: ConnectionState): ConnectionStep => {
  if (state.phase !== EStreamConnectionState.Backoff) return stay(state)
  return {
    state: { ...state, phase: EStreamConnectionState.Connecting, attempt: 0, failures: 0 },
    effects: [cancelReconnect, subscribe],
  }
}

const reconnectRequested = (state: ConnectionState): ConnectionStep => {
  if (state.phase === EStreamConnectionState.Backoff) {
    return {
      state: {
        ...state,
        phase: EStreamConnectionState.Connecting,
        attempt: 0,
        failures: 0,
        reason: undefined,
        reconnectAfterMs: undefined,
      },
      effects: [cancelReconnect, subscribe],
    }
  }
  if (
    state.phase === EStreamConnectionState.Closed &&
    state.reason === EStreamClosedReason.Unauthenticated
  ) {
    return {
      state: {
        ...state,
        phase: EStreamConnectionState.Connecting,
        attempt: 0,
        failures: 0,
        reason: undefined,
        reconnectAfterMs: undefined,
      },
      effects: [subscribe],
    }
  }
  return stay(state)
}

export const reduceConnection = (args: ReduceArgs): ConnectionStep => {
  const { state, input, random } = args
  switch (input.type) {
    case 'connect':
      return connect(state)
    case 'opened':
      return opened(state)
    case 'going-away':
      return goingAway({ state, reconnectAfterMs: input.reconnectAfterMs })
    case 'ended':
      return ended({ state, random })
    case 'failure':
      return failed({ state, status: input.status, random })
    case 'timer-fired':
      return timerFired({ ...args, timer: input.timer })
    case 'close-requested':
      return closeRequested(state)
    case 'network-online':
      return networkOnline(state)
    case 'reconnect-requested':
      return reconnectRequested(state)
  }
}
