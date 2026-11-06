import { describe, expect, it } from 'bun:test'

import {
  EConnectionTimer,
  EStreamConnectionState,
  HANDSHAKE_LIMIT_MS,
  initialConnectionState,
} from '../connection-machine'
import {
  authenticatingState,
  backoffState,
  connectingState,
  frame,
  handshakeTimer,
  openState,
  READY,
  scheduledDelay,
  step,
} from './machine-support'

describe('the connection machine triggers', () => {
  it.each([
    ['Connecting', connectingState],
    ['Authenticating', authenticatingState],
  ])('closes the socket and backs off when the handshake deadline fires in %s', (_, build) => {
    const fired = step({
      state: build(),
      input: { type: 'timer-fired', timer: EConnectionTimer.Handshake },
      now: HANDSHAKE_LIMIT_MS,
      random: 1,
    })
    expect(fired.state.phase).toBe(EStreamConnectionState.Backoff)
    expect(fired.effects).toContainEqual({ type: 'closeSocket' })
    expect(scheduledDelay(fired.effects)).toBe(500)
  })

  it('cancels the handshake deadline when ready arrives and ignores a late firing', () => {
    let state = authenticatingState()
    const ready = step({ state, input: frame(READY) })
    expect(ready.effects).toContainEqual({
      type: 'cancel',
      timer: EConnectionTimer.Handshake,
    })
    state = ready.state
    const late = step({
      state,
      input: { type: 'timer-fired', timer: EConnectionTimer.Handshake },
    })
    expect(late.state).toEqual(state)
    expect(late.effects).toEqual([])
  })

  it('cancels the handshake deadline when the handshake ends another way', () => {
    const cancel = { type: 'cancel', timer: EConnectionTimer.Handshake } as const
    const dropped = step({
      state: authenticatingState(),
      input: { type: 'socket-closed', code: 1006 },
    })
    expect(dropped.effects).toContainEqual(cancel)
    const failed = step({
      state: connectingState(),
      input: { type: 'token-failed' },
    })
    expect(failed.effects).toContainEqual(cancel)
    const requested = step({
      state: connectingState(),
      input: { type: 'close-requested' },
    })
    expect(requested.effects).toContainEqual(cancel)
  })

  it('reconnects at once on network-online during backoff and resets the backoff', () => {
    const waiting = backoffState(3)
    expect(waiting.attempt).toBe(4)
    const online = step({ state: waiting, input: { type: 'network-online' } })
    expect(online.state.phase).toBe(EStreamConnectionState.Connecting)
    expect(online.state.attempt).toBe(0)
    expect(online.effects).toEqual([
      { type: 'cancel', timer: EConnectionTimer.Reconnect },
      { type: 'openSocket' },
      handshakeTimer,
    ])
    const dropped = step({
      state: online.state,
      input: { type: 'socket-closed', code: 1006 },
      random: 1,
    })
    expect(scheduledDelay(dropped.effects)).toBe(500)
  })

  it.each([
    ['Open', openState],
    ['Connecting', connectingState],
    ['Authenticating', authenticatingState],
    ['Closed', initialConnectionState],
  ])('ignores network-online while %s', (_, build) => {
    const state = build()
    const online = step({ state, input: { type: 'network-online' } })
    expect(online.state).toEqual(state)
    expect(online.effects).toEqual([])
  })
})
