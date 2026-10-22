import { describe, expect, it } from 'vitest'

import { ERuntimePhase } from '@dltech/atlas-wire'

import {
  connectionViewOf,
  EConnectionView,
  ESocketLiveness,
  isTransitioning,
  wakesOnSend,
  type ConnectionFacts,
} from '../connection-view'

const facts = (overrides: Partial<ConnectionFacts>): ConnectionFacts => ({
  phase: null,
  socket: ESocketLiveness.Closed,
  waking: false,
  rotating: false,
  failure: null,
  detached: false,
  ...overrides,
})

describe('connectionViewOf', () => {
  const table: readonly [string, Partial<ConnectionFacts>, EConnectionView][] = [
    [
      'serving + open',
      { phase: ERuntimePhase.Serving, socket: ESocketLiveness.Open },
      EConnectionView.Connected,
    ],
    ['no record + open', { socket: ESocketLiveness.Open }, EConnectionView.Connected],
    [
      'updating + open',
      { phase: ERuntimePhase.Updating, socket: ESocketLiveness.Open },
      EConnectionView.Connected,
    ],
    [
      'parking + open',
      { phase: ERuntimePhase.Parking, socket: ESocketLiveness.Open },
      EConnectionView.Connected,
    ],
    [
      'parked + open',
      { phase: ERuntimePhase.Parked, socket: ESocketLiveness.Open },
      EConnectionView.Parked,
    ],
    ['serving + closed', { phase: ERuntimePhase.Serving }, EConnectionView.Reconnecting],
    [
      'serving + dialing',
      { phase: ERuntimePhase.Serving, socket: ESocketLiveness.Dialing },
      EConnectionView.Reconnecting,
    ],
    ['no record + closed', {}, EConnectionView.Reconnecting],
    ['updating + closed', { phase: ERuntimePhase.Updating }, EConnectionView.Updating],
    ['waking + closed', { phase: ERuntimePhase.Waking }, EConnectionView.Waking],
    [
      'provisioning + dialing',
      { phase: ERuntimePhase.Provisioning, socket: ESocketLiveness.Dialing },
      EConnectionView.Waking,
    ],
    ['parked + closed', { phase: ERuntimePhase.Parked }, EConnectionView.Parked],
    ['parking + closed', { phase: ERuntimePhase.Parking }, EConnectionView.Parked],
    ['never attached', { socket: ESocketLiveness.Unattached }, EConnectionView.Parked],
    [
      'serving record, never attached',
      { phase: ERuntimePhase.Serving, socket: ESocketLiveness.Unattached },
      EConnectionView.Parked,
    ],
    [
      'local wake beats a parked record',
      { phase: ERuntimePhase.Parked, waking: true },
      EConnectionView.Waking,
    ],
    ['wake beats a stale failure', { failure: 'gone', waking: true }, EConnectionView.Waking],
    [
      'spent retries',
      { phase: ERuntimePhase.Serving, failure: 'did not reopen' },
      EConnectionView.Disconnected,
    ],
    [
      'failure beats a parked record',
      { phase: ERuntimePhase.Parked, failure: 'wake failed' },
      EConnectionView.Disconnected,
    ],
    [
      'detached beats everything',
      { socket: ESocketLiveness.Open, detached: true },
      EConnectionView.Detached,
    ],
    ['rotating wake beats waking', { waking: true, rotating: true }, EConnectionView.Updating],
    [
      'rotating beats a serving record',
      { phase: ERuntimePhase.Serving, waking: true, rotating: true },
      EConnectionView.Updating,
    ],
    [
      'rotating beats a stale failure',
      { failure: 'gone', rotating: true },
      EConnectionView.Updating,
    ],
    [
      'an open socket beats rotating',
      { socket: ESocketLiveness.Open, rotating: true },
      EConnectionView.Connected,
    ],
    [
      'detached beats rotating',
      { rotating: true, waking: true, detached: true },
      EConnectionView.Detached,
    ],
  ]

  for (const [name, given, expected] of table) {
    it(name, () => {
      expect(connectionViewOf(facts(given)).state).toBe(expected)
    })
  }

  it('carries the failure as the disconnected detail', () => {
    expect(connectionViewOf(facts({ failure: 'the pod could not be woken: 503' }))).toEqual({
      state: EConnectionView.Disconnected,
      detail: 'the pod could not be woken: 503',
    })
  })

  it('names the swap while updating', () => {
    expect(connectionViewOf(facts({ phase: ERuntimePhase.Updating })).detail).toBe(
      'updating the pod',
    )
  })

  it('names the swap while a wake rotates the sandbox', () => {
    expect(connectionViewOf(facts({ waking: true, rotating: true }))).toEqual({
      state: EConnectionView.Updating,
      detail: 'updating the pod',
    })
  })
})

describe('view predicates', () => {
  it('wakes on send only while the container is away', () => {
    const waking = Object.values(EConnectionView).filter(wakesOnSend)
    expect(waking.sort()).toEqual(
      [
        EConnectionView.Disconnected,
        EConnectionView.Parked,
        EConnectionView.Updating,
        EConnectionView.Waking,
      ].sort(),
    )
  })

  it('treats waking, reconnecting and updating as transitions', () => {
    const moving = Object.values(EConnectionView).filter(isTransitioning)
    expect(moving.sort()).toEqual(
      [EConnectionView.Reconnecting, EConnectionView.Updating, EConnectionView.Waking].sort(),
    )
  })
})
