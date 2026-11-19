import { describe, expect, it } from 'bun:test'

import {
  backoffDelayMs,
  EConnectionTimer,
  EStreamClosedReason,
  EStreamConnectionState,
  initialConnectionState,
  reduceConnection,
  type ConnectionInput,
  type ConnectionState,
} from '../connection-machine'

const step = (state: ConnectionState, input: ConnectionInput, random = 0.5) =>
  reduceConnection({ state, input, random })

const open = (): ConnectionState =>
  step(step(initialConnectionState(), { type: 'connect' }).state, { type: 'opened' }).state

const reconnectTimer = { type: 'schedule', timer: EConnectionTimer.Reconnect } as const

describe('the stream connection machine', () => {
  it('opens a subscription when connecting and settles once a frame arrives', () => {
    const connecting = step(initialConnectionState(), { type: 'connect' })
    expect(connecting.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(connecting.effects).toEqual([{ type: 'subscribe' }])
    expect(step(connecting.state, { type: 'opened' }).state.phase).toBe(EStreamConnectionState.Open)
  })

  it('ignores a connect while it is already running', () => {
    const state = open()
    expect(step(state, { type: 'connect' })).toEqual({ state, effects: [] })
  })

  it('backs off after a clean end and subscribes again when the timer fires', () => {
    const ended = step(open(), { type: 'ended' }, 1)
    expect(ended.state.phase).toBe(EStreamConnectionState.Backoff)
    expect(ended.effects).toContainEqual({ ...reconnectTimer, ms: 500 })
    expect(ended.effects).toContainEqual({ type: 'abort' })
    const again = step(ended.state, { type: 'timer-fired', timer: EConnectionTimer.Reconnect })
    expect(again.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(again.effects).toEqual([{ type: 'subscribe' }])
  })

  it('reconnects after the delay a going-away frame names', () => {
    const draining = step(open(), { type: 'going-away', reconnectAfterMs: 1_200 }).state
    expect(draining.reconnectAfterMs).toBe(1_200)
    const ended = step(draining, { type: 'ended' }, 1)
    expect(ended.effects).toContainEqual({ ...reconnectTimer, ms: 1_200 })
    expect(ended.state.attempt).toBe(0)
  })

  it('grows the backoff with each attempt', () => {
    expect(backoffDelayMs({ attempt: 0, random: 1 })).toBe(500)
    expect(backoffDelayMs({ attempt: 3, random: 1 })).toBe(4_000)
    expect(backoffDelayMs({ attempt: 20, random: 1 })).toBe(15_000)
  })

  it('keeps backing off through repeated failures', () => {
    const first = step(open(), { type: 'failure', status: 500 }, 1)
    expect(first.state.phase).toBe(EStreamConnectionState.Backoff)
    expect(first.effects).toContainEqual({ ...reconnectTimer, ms: 500 })
    const retried = step(first.state, {
      type: 'timer-fired',
      timer: EConnectionTimer.Reconnect,
    }).state
    const second = step(retried, { type: 'failure', status: 500 }, 1)
    expect(second.state.phase).toBe(EStreamConnectionState.Backoff)
    expect(second.state.failures).toBe(2)
    expect(second.effects).toContainEqual({ ...reconnectTimer, ms: 1_000 })
    const third = step(
      step(second.state, { type: 'timer-fired', timer: EConnectionTimer.Reconnect }).state,
      { type: 'failure', status: 500 },
      1,
    )
    expect(third.state.phase).toBe(EStreamConnectionState.Backoff)
  })

  it('reconnects at once when the user asks while it is backing off', () => {
    const backoff = step(open(), { type: 'failure', status: 500 }).state
    const asked = step(backoff, { type: 'reconnect-requested' })
    expect(asked.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(asked.state.attempt).toBe(0)
    expect(asked.state.failures).toBe(0)
    expect(asked.effects).toEqual([
      { type: 'cancel', timer: EConnectionTimer.Reconnect },
      { type: 'subscribe' },
    ])
  })

  it('reconnects when the user asks after a sign-in closes it', () => {
    const unauthenticated = step(open(), { type: 'failure', status: 401 }).state
    const asked = step(unauthenticated, { type: 'reconnect-requested' })
    expect(asked.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(asked.state.reason).toBeUndefined()
    expect(asked.effects).toEqual([{ type: 'subscribe' }])
  })

  it('ignores a reconnect it cannot honour', () => {
    const requested = step(open(), { type: 'close-requested' }).state
    expect(step(requested, { type: 'reconnect-requested' })).toEqual({
      state: requested,
      effects: [],
    })
    const running = open()
    expect(step(running, { type: 'reconnect-requested' })).toEqual({ state: running, effects: [] })
  })

  it('closes without retrying when the session is not accepted', () => {
    const rejected = step(open(), { type: 'failure', status: 401 })
    expect(rejected.state.phase).toBe(EStreamConnectionState.Closed)
    expect(rejected.state.reason).toBe(EStreamClosedReason.Unauthenticated)
  })

  it('retries at once when the network comes back', () => {
    const backoff = step(open(), { type: 'ended' }).state
    const online = step(backoff, { type: 'network-online' })
    expect(online.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(online.effects).toEqual([
      { type: 'cancel', timer: EConnectionTimer.Reconnect },
      { type: 'subscribe' },
    ])
  })

  it('stops everything when the connection is closed on request', () => {
    const closed = step(open(), { type: 'close-requested' })
    expect(closed.state.phase).toBe(EStreamConnectionState.Closed)
    expect(closed.state.reason).toBe(EStreamClosedReason.Requested)
    expect(closed.effects).toContainEqual({ type: 'abort' })
  })
})
