import { describe, expect, it } from 'bun:test'

import type { PrStateWire } from '@dltech/atlas-wire/web'

import { subscribeApiPrStates } from '../api-pr-states-source'
import { prStateFrameOf, prStatesSourceRig } from './api-pr-states.fixture'

describe('subscribeApiPrStates reconnect', () => {
  it('shares one subscription between consumers and replays cached states to a newcomer', () => {
    const rig = prStatesSourceRig()
    const sidebar: (readonly PrStateWire[])[] = []
    const details: (readonly PrStateWire[])[] = []
    const stopSidebar = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => sidebar.push(states),
    })
    rig.latest()?.onData(prStateFrameOf(3))
    const stopDetails = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => details.push(states),
    })
    expect(rig.connections).toHaveLength(1)
    expect(details.at(-1)).toBe(sidebar.at(-1))
    stopSidebar()
    rig.latest()?.onData(prStateFrameOf(4))
    expect(sidebar.at(-1)?.[0]?.checksPassed).toBe(3)
    expect(details.at(-1)?.[0]?.checksPassed).toBe(4)
    const remounted: (readonly PrStateWire[])[] = []
    const stopRemounted = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => remounted.push(states),
    })
    expect(rig.connections).toHaveLength(1)
    expect(remounted.at(-1)?.[0]?.checksPassed).toBe(4)
    stopRemounted()
    stopDetails()
    expect(rig.active()).toBe(0)
  })

  it('reconnects a dropped stream once after a backoff and keeps cached states meanwhile', async () => {
    const rig = prStatesSourceRig()
    const seen: (readonly PrStateWire[])[] = []
    const stop = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => seen.push(states),
    })
    rig.latest()?.onData(prStateFrameOf(2))
    const dropped = rig.latest()
    dropped?.onError(new Error('offline'))
    dropped?.onComplete()
    expect(rig.connections[0]?.stops).toBe(1)
    expect(seen.at(-1)?.[0]?.checksPassed).toBe(2)
    await Bun.sleep(1100)
    expect(rig.connections).toHaveLength(2)
    rig.latest()?.onData(prStateFrameOf(5))
    expect(seen.at(-1)?.[0]?.checksPassed).toBe(5)
    expect(rig.peak()).toBe(1)
    stop()
    expect(rig.active()).toBe(0)
  })

  it('asks the transport for nothing but frames and endings', () => {
    const rig = prStatesSourceRig()
    const stop = subscribeApiPrStates({ subscribe: rig.subscribe, onStates: () => {} })
    expect(Object.keys({ ...rig.latest() }).sort()).toEqual(['onComplete', 'onData', 'onError'])
    stop()
  })
})
