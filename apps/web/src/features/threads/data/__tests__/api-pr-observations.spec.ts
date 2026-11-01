import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { EGithubPrStatesFrame, type PrStateWire } from '@dltech/atlas-wire/web'

import { subscribeApiPrStates } from '../api-pr-states-source'
import type { PrObservationStatus } from '../pr-observation-status'
import { observationFrameOf, observationSourceRig } from './pr-observation.fixture'

beforeAll(() => {
  GlobalRegistrator.register()
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
beforeEach(() => setVisibility('visible'))

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
  document.dispatchEvent(new Event('visibilitychange'))
}

const target = (number: number) => ({ repo: 'owner/repo', number })

describe('bounded PR observation union', () => {
  it('unions sidebar and details on one channel, retains cached state, and removes only departing targets', () => {
    const rig = observationSourceRig()
    const firstStates: (readonly PrStateWire[])[] = []
    const sidebar = subscribeApiPrStates({
      subscribe: rig.subscribe,
      observe: [target(2), target(1)],
      onStates: (states) => firstStates.push(states),
    })
    rig.latest()?.onData(observationFrameOf(3))
    const old = rig.latest()
    const secondStates: (readonly PrStateWire[])[] = []
    const details = subscribeApiPrStates({
      subscribe: rig.subscribe,
      observe: [target(3), { repo: 'github.com/OWNER/REPO', number: 2 }],
      onStates: (states) => secondStates.push(states),
    })
    expect(rig.observations()).toEqual([target(1), target(2), target(3)])
    expect(secondStates.at(-1)).toBe(firstStates.at(-1))
    expect(rig.active()).toBe(1)
    expect(rig.peak()).toBe(1)
    old?.onData(observationFrameOf(99))
    expect(firstStates.at(-1)?.[0]?.checksPassed).toBe(3)
    const opens = rig.connections.length
    details.setObservations([{ repo: 'https://github.com/owner/repo.git', number: 2 }, target(3)])
    expect(rig.connections).toHaveLength(opens)
    sidebar()
    expect(rig.observations()).toEqual([target(2), target(3)])
    rig.latest()?.onData(observationFrameOf(4))
    expect(secondStates.at(-1)?.[0]?.checksPassed).toBe(4)
    details()
    expect(rig.active()).toBe(0)
  })

  it('keeps old consumer subscriptions cached-only and drops observations on hide, restore, update and unmount', () => {
    const rig = observationSourceRig()
    const cached = subscribeApiPrStates({ subscribe: rig.subscribe, onStates: () => {} })
    expect(rig.latest()?.observe).toBeUndefined()
    const observing = subscribeApiPrStates({
      subscribe: rig.subscribe,
      observe: [target(1)],
      onStates: () => {},
    })
    expect(rig.observations()).toEqual([target(1)])
    setVisibility('hidden')
    expect(rig.observations()).toEqual([])
    observing.setObservations([target(2)])
    const whileHidden = rig.connections.length
    expect(rig.observations()).toEqual([])
    setVisibility('visible')
    expect(rig.connections).toHaveLength(whileHidden + 1)
    expect(rig.observations()).toEqual([target(2)])
    observing()
    expect(rig.observations()).toEqual([])
    expect(rig.active()).toBe(1)
    cached()
    setVisibility('hidden')
    expect(rig.active()).toBe(0)
    expect(rig.peak()).toBe(1)
  })

  it('strictly caps the deterministic normalized union at128 and does not reconnect for excluded overflow', () => {
    const rig = observationSourceRig()
    const many = Array.from({ length: 150 }, (_, index) => target(150 - index))
    const stop = subscribeApiPrStates({
      subscribe: rig.subscribe,
      observe: [...many, target(1), { repo: 'not a repo', number: 1 }, target(-1)],
      onStates: () => {},
    })
    expect(rig.observations()).toHaveLength(128)
    expect(rig.observations()).toEqual(Array.from({ length: 128 }, (_, index) => target(index + 1)))
    const opens = rig.connections.length
    stop.setObservations([...many, target(999)])
    expect(rig.connections).toHaveLength(opens)
    stop()
  })

  it('does not acquire a lease while the document starts hidden', () => {
    setVisibility('hidden')
    const rig = observationSourceRig()
    const stop = subscribeApiPrStates({
      subscribe: rig.subscribe,
      observe: [target(1)],
      onStates: () => {},
    })
    expect(rig.latest()?.observe).toBeUndefined()
    stop()
  })

  it('cancels unavailable-acquisition retries while hidden and warns about a disconnected observing stream', async () => {
    const rig = observationSourceRig()
    const statuses: (PrObservationStatus | null)[] = []
    const stop = subscribeApiPrStates({
      subscribe: rig.subscribe,
      observe: [target(1)],
      onStates: () => {},
      onObservationStatus: (status) => statuses.push(status),
    })
    rig
      .latest()
      ?.onData({ type: EGithubPrStatesFrame.ObservationStatus, available: false, retryAfterMs: 0 })
    setVisibility('hidden')
    expect(statuses.at(-1)).toBeNull()
    const hiddenConnections = rig.connections.length
    await Bun.sleep(1100)
    expect(rig.connections).toHaveLength(hiddenConnections)
    setVisibility('visible')
    rig.latest()?.onError(new Error('offline'))
    expect(statuses.at(-1)?.message).toContain('Cached checks may be stale')
    stop()
    expect(statuses.at(-1)).toBeNull()
    expect(rig.active()).toBe(0)
  })

  it('keeps cached/webhook updates usable during an observation outage, retries, and clears on recovery', async () => {
    const rig = observationSourceRig()
    const states: (readonly PrStateWire[])[] = []
    const statuses: (PrObservationStatus | null)[] = []
    const stop = subscribeApiPrStates({
      subscribe: rig.subscribe,
      observe: [target(1)],
      onStates: (next) => states.push(next),
      onObservationStatus: (next) => statuses.push(next),
    })
    rig.latest()?.onData(observationFrameOf(1))
    rig.latest()?.onData({
      type: EGithubPrStatesFrame.ObservationStatus,
      available: false,
      message: 'Observation store unavailable',
      retryAfterMs: 0,
    })
    expect(rig.active()).toBe(1)
    expect(rig.connections).toHaveLength(1)
    rig.latest()?.onData(observationFrameOf(2))
    expect(states.at(-1)?.[0]?.checksPassed).toBe(2)
    expect(statuses.at(-1)?.available).toBe(false)
    await Bun.sleep(1100)
    expect(rig.connections).toHaveLength(2)
    expect(rig.observations()).toEqual([target(1)])
    const replayed: (readonly PrStateWire[])[] = []
    const cached = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (next) => replayed.push(next),
    })
    expect(replayed.at(-1)?.[0]?.checksPassed).toBe(2)
    rig.latest()?.onData({ type: EGithubPrStatesFrame.ObservationStatus, available: true })
    expect(statuses.at(-1)?.available).toBe(true)
    stop.setObservations([])
    expect(statuses.at(-1)).toBeNull()
    cached()
    stop()
    expect(rig.peak()).toBe(1)
  })
})
