import { STREAM_PROTOCOL_VERSION, type StreamServerMessage } from '@dltech/atlas-protocol'

import {
  EConnectionTimer,
  HANDSHAKE_LIMIT_MS,
  initialConnectionState,
  reduceConnection,
  type ConnectionInput,
  type ConnectionState,
} from '../connection-machine'

export const step = (params: {
  state: ConnectionState
  input: ConnectionInput
  now?: number
  random?: number
}) =>
  reduceConnection({
    state: params.state,
    input: params.input,
    now: params.now ?? 0,
    random: params.random ?? 0.5,
  })

export const frame = (message: StreamServerMessage): ConnectionInput => ({
  type: 'message',
  data: JSON.stringify(message),
})

export const READY: StreamServerMessage = {
  type: 'ready',
  v: STREAM_PROTOCOL_VERSION,
  connectionId: 'c1',
}

export const handshakeTimer = {
  type: 'schedule',
  timer: EConnectionTimer.Handshake,
  ms: HANDSHAKE_LIMIT_MS,
} as const

export const connectingState = (): ConnectionState =>
  step({ state: initialConnectionState(), input: { type: 'connect' } }).state

export const authenticatingState = (): ConnectionState =>
  step({
    state: connectingState(),
    input: { type: 'socket-opened', token: 't' },
  }).state

export const openState = (now = 0): ConnectionState => {
  const state = step({
    state: connectingState(),
    input: { type: 'socket-opened', token: 't' },
    now,
  }).state
  return step({ state, input: frame(READY), now }).state
}

export const backoffState = (attempt: number): ConnectionState => {
  let state = openState()
  for (let drop = 0; drop <= attempt; drop += 1) {
    if (drop > 0) {
      state = step({
        state,
        input: { type: 'timer-fired', timer: EConnectionTimer.Reconnect },
      }).state
    }
    state = step({
      state,
      input: { type: 'socket-closed', code: 1006 },
      random: 1,
    }).state
  }
  return state
}

export const scheduledDelay = (effects: readonly { type: string; ms?: number; timer?: string }[]) =>
  effects.find(
    (effect) => effect.type === 'schedule' && effect.timer === EConnectionTimer.Reconnect,
  )?.ms
