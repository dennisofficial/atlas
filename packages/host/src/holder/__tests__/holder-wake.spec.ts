import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { FakeClock, flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

describe('SessionHolder wake routing', () => {
  it('a held idle session takes a new message the moment the wake fires, with no timer advance', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    await rig.post('follow up')
    await rig.bus.wake(SESSION)
    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 100,
    })
    expect(answered).toBe(true)
    expect(rig.clock.now()).toBe(0)
  }, 15_000)

  it('a resync re-reads the inbox of every held session', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    await rig.post('missed wake')
    rig.bus.resync()
    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 100,
    })
    expect(answered).toBe(true)
  }, 15_000)

  it('a resync claims sessions that need a holder', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('orphaned')
    rig.bus.resync()
    const claimed = await flushUntil({
      check: () => rig.holder.heldIds().length === 1,
      attempts: 100,
    })
    expect(claimed).toBe(true)
    const answered = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      attempts: 100,
    })
    expect(answered).toBe(true)
  }, 15_000)
  it('a wake that lands between the last inbox read and the idle wait is not lost', async () => {
    const clock = new FakeClock()
    const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
    const plane = new ControlPlane({ store })
    const rig = await makeRig({ clock, plane, store })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    const readInbox = plane.readInbox.bind(plane)
    let pendingReads = 0
    plane.readInbox = async (params) => {
      const entries = await readInbox(params)
      if (params.limit !== 100) return entries
      pendingReads += 1
      if (pendingReads === 1) {
        await rig.post('raced')
        await rig.bus.wake(SESSION)
      }
      return entries
    }
    await rig.bus.wake(SESSION)

    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 100,
    })
    expect(pendingReads).toBeGreaterThanOrEqual(2)
    expect(answered).toBe(true)
    expect(rig.clock.now()).toBe(0)
  }, 15_000)
})
