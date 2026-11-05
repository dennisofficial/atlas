import { describe, expect, it } from 'bun:test'
import {
  EStreamResetReason,
  STREAM_PROTOCOL_VERSION,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import {
  backoffDelayMs,
  EConnectionTimer,
  EStreamClosedReason,
  EStreamConnectionState,
  initialConnectionState,
  reduceConnection,
  SILENCE_LIMIT_MS,
  type ConnectionInput,
  type ConnectionState,
} from '../connection-machine'

const step = (params: {
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

const frame = (message: StreamServerMessage): ConnectionInput => ({
  type: 'message',
  data: JSON.stringify(message),
})

const READY: StreamServerMessage = { type: 'ready', v: STREAM_PROTOCOL_VERSION, connectionId: 'c1' }

const openState = (now = 0): ConnectionState => {
  let state = step({ state: initialConnectionState(), input: { type: 'connect' } }).state
  state = step({ state, input: { type: 'socket-opened', token: 't' }, now }).state
  return step({ state, input: frame(READY), now }).state
}

const scheduledDelay = (effects: readonly { type: string; ms?: number; timer?: string }[]) =>
  effects.find(
    (effect) => effect.type === 'schedule' && effect.timer === EConnectionTimer.Reconnect,
  )?.ms

describe('backoffDelayMs', () => {
  it('doubles from 500ms and caps at 15s at full jitter', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 20].map((attempt) =>
      backoffDelayMs({ attempt, random: 1 }),
    )
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000, 15000])
  })

  it('scales the ceiling by the random draw', () => {
    expect(backoffDelayMs({ attempt: 3, random: 0 })).toBe(0)
    expect(backoffDelayMs({ attempt: 3, random: 0.5 })).toBe(2000)
  })
})

describe('the connection machine', () => {
  it('opens a socket on connect and sends hello once the socket opens', () => {
    const connecting = step({ state: initialConnectionState(), input: { type: 'connect' } })
    expect(connecting.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(connecting.effects).toEqual([{ type: 'openSocket' }])

    const opened = step({ state: connecting.state, input: { type: 'socket-opened', token: 'tok' } })
    expect(opened.state.phase).toBe(EStreamConnectionState.Authenticating)
    expect(opened.effects).toEqual([
      { type: 'send', message: { type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'tok' } },
    ])
  })

  it('goes Open on ready, arms the silence timer and delivers the message', () => {
    let state = step({ state: initialConnectionState(), input: { type: 'connect' } }).state
    state = step({ state, input: { type: 'socket-opened', token: 't' } }).state
    const ready = step({ state, input: frame(READY) })
    expect(ready.state.phase).toBe(EStreamConnectionState.Open)
    expect(ready.effects).toContainEqual({
      type: 'schedule',
      timer: EConnectionTimer.Silence,
      ms: SILENCE_LIMIT_MS,
    })
    expect(ready.effects).toContainEqual({ type: 'deliver', message: READY })
  })

  it('grows the backoff across consecutive drops and resets it on ready', () => {
    let state = openState()
    const delays: (number | undefined)[] = []
    for (let drop = 0; drop < 3; drop += 1) {
      const dropped = step({ state, input: { type: 'socket-closed', code: 1006 }, random: 1 })
      delays.push(scheduledDelay(dropped.effects))
      const retried = step({
        state: dropped.state,
        input: { type: 'timer-fired', timer: EConnectionTimer.Reconnect },
      })
      expect(retried.effects).toEqual([{ type: 'openSocket' }])
      state = step({ state: retried.state, input: { type: 'socket-opened', token: 't' } }).state
    }
    expect(delays).toEqual([500, 1000, 2000])

    state = step({ state, input: frame(READY) }).state
    expect(state.attempt).toBe(0)
    const afterReset = step({ state, input: { type: 'socket-closed', code: 1006 }, random: 1 })
    expect(scheduledDelay(afterReset.effects)).toBe(500)
  })

  it('applies full jitter to the delay', () => {
    const dropped = step({
      state: openState(),
      input: { type: 'socket-closed', code: 1006 },
      random: 0.25,
    })
    expect(scheduledDelay(dropped.effects)).toBe(125)
  })

  it('lets the recorded closing code win over the raw 1005 close code', () => {
    const state = step({
      state: openState(),
      input: frame({ type: 'closing', code: 4401 }),
    }).state
    const closed = step({ state, input: { type: 'socket-closed', code: 1005 } })
    expect(closed.state.phase).toBe(EStreamConnectionState.Closed)
    expect(closed.state.reason).toBe(EStreamClosedReason.Unauthenticated)
    expect(scheduledDelay(closed.effects)).toBeUndefined()
  })

  it('reconnects after a 1005 close that carried no closing frame', () => {
    const closed = step({ state: openState(), input: { type: 'socket-closed', code: 1005 } })
    expect(closed.state.phase).toBe(EStreamConnectionState.Backoff)
  })

  it('stops on a raw 4401 close and reconnects on the next connect', () => {
    const closed = step({ state: openState(), input: { type: 'socket-closed', code: 4401 } })
    expect(closed.state.phase).toBe(EStreamConnectionState.Closed)
    const again = step({ state: closed.state, input: { type: 'connect' } })
    expect(again.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(again.state.reason).toBeUndefined()
    expect(again.effects).toEqual([{ type: 'openSocket' }])
  })

  it('backs off for exactly reconnectAfterMs after going-away', () => {
    const state = step({
      state: openState(),
      input: frame({ type: 'going-away', reconnectAfterMs: 2500 }),
    }).state
    const closed = step({ state, input: { type: 'socket-closed', code: 1001 }, random: 0.01 })
    expect(closed.state.phase).toBe(EStreamConnectionState.Backoff)
    expect(scheduledDelay(closed.effects)).toBe(2500)
  })

  it('closes and backs off after 45s without a frame', () => {
    const state = openState(0)
    const fired = step({
      state,
      input: { type: 'timer-fired', timer: EConnectionTimer.Silence },
      now: SILENCE_LIMIT_MS,
    })
    expect(fired.state.phase).toBe(EStreamConnectionState.Backoff)
    expect(fired.effects).toContainEqual({ type: 'closeSocket' })
    expect(scheduledDelay(fired.effects)).toBeDefined()
  })

  it('re-arms the silence timer for the remainder when a frame arrived meanwhile', () => {
    let state = openState(0)
    state = step({ state, input: frame({ type: 'pong' }), now: 30_000 }).state
    const fired = step({
      state,
      input: { type: 'timer-fired', timer: EConnectionTimer.Silence },
      now: SILENCE_LIMIT_MS,
    })
    expect(fired.state.phase).toBe(EStreamConnectionState.Open)
    expect(fired.effects).toEqual([
      { type: 'schedule', timer: EConnectionTimer.Silence, ms: 30_000 },
    ])
  })

  it('delivers server messages only while Open', () => {
    const view: StreamServerMessage = { type: 'pong' }
    const events: StreamServerMessage = {
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 0,
    }
    const delivered = step({ state: openState(), input: frame(events) })
    expect(delivered.effects).toEqual([{ type: 'deliver', message: events }])
    expect(step({ state: openState(), input: frame(view) }).effects).toEqual([])
    const backoff = step({ state: openState(), input: { type: 'socket-closed', code: 1006 } })
    expect(step({ state: backoff.state, input: frame(events) }).effects).toEqual([])
  })

  it('ignores unparseable and unknown frames', () => {
    const state = openState()
    expect(step({ state, input: { type: 'message', data: 'not json' } }).effects).toEqual([])
    expect(
      step({ state, input: { type: 'message', data: '{"type":"from-the-future"}' } }).effects,
    ).toEqual([])
  })

  it('backs off when the token cannot be fetched', () => {
    const connecting = step({ state: initialConnectionState(), input: { type: 'connect' } }).state
    const failed = step({ state: connecting, input: { type: 'token-failed' }, random: 1 })
    expect(failed.state.phase).toBe(EStreamConnectionState.Backoff)
    expect(scheduledDelay(failed.effects)).toBe(500)
  })

  it('closes for good on a close request and ignores the late socket close', () => {
    const requested = step({ state: openState(), input: { type: 'close-requested' } })
    expect(requested.state.phase).toBe(EStreamConnectionState.Closed)
    expect(requested.state.reason).toBe(EStreamClosedReason.Requested)
    expect(requested.effects).toContainEqual({ type: 'closeSocket' })
    const late = step({ state: requested.state, input: { type: 'socket-closed', code: 1000 } })
    expect(late.state).toEqual(requested.state)
    expect(late.effects).toEqual([])
  })
})
