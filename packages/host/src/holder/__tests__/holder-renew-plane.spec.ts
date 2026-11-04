import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'
import { FakeClock } from './rig-fakes'

const neverResolves = <T>(): Promise<T> => new Promise<T>(() => undefined)

describe('SessionHolder lease plane', () => {
  it('keeps renewing on leasePlane past the fence deadline while the turn plane is stalled', async () => {
    const clock = new FakeClock()
    const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
    const plane = new ControlPlane({ store })
    const leasePlane = new ControlPlane({ store })
    const rig = await makeRig({ clock, plane, leasePlane, script: [{ text: 'ok' }] })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const turnDone = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      clock,
    })
    expect(turnDone).toBe(true)
    expect(rig.holder.heldIds()).toContain(SESSION)

    let leaseRenews = 0
    const originalRenew = leasePlane.renew.bind(leasePlane)
    leasePlane.renew = (params) => {
      leaseRenews += 1
      return originalRenew(params)
    }
    plane.append = () => neverResolves()
    plane.renew = () => neverResolves()

    const renewedPastFence = await flushUntil({
      check: () => leaseRenews >= 3 && clock.current > 30_000,
      clock,
      advanceMs: 5_000,
      attempts: 100,
    })
    expect(renewedPastFence).toBe(true)
    expect(clock.current).toBeGreaterThan(30_000)
    expect(rig.holder.heldIds()).toContain(SESSION)
    rig.holder.discard()
  }, 15_000)
})
