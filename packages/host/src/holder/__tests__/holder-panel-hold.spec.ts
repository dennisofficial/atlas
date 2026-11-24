import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

describe('SessionHolder with a panel hold from another host', () => {
  it('arms the hold where the lease lives and keeps the session past idle', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    rig.bus.deliverPanelHold({ sessionId: SESSION, ttlMs: 60_000 })
    await rig.post('hello')
    await rig.wake()

    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'assistant-said').length === 1,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([SESSION])
    expect(rig.runtimes[0]?.released).toBe(false)

    rig.holder.demandOf().panel.release(SESSION)
    rig.holder.demandOf().requestReconcile(SESSION)
    const released = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(released).toBe(true)
    expect(rig.runtimes[0]?.released).toBe(true)
  }, 15_000)

  it('publishes a heartbeat to the other hosts', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()

    expect(rig.holder.demandOf().holdPanel({ sessionId: SESSION, ttlMs: 45 })).toBe(true)
    expect(rig.bus.holds).toEqual([{ sessionId: SESSION, ttlMs: 45 }])
    expect(rig.holder.demandOf().panel.holds(SESSION)).toBe(true)

    await Bun.sleep(80)
    expect(rig.holder.demandOf().panel.holds(SESSION)).toBe(false)
  }, 15_000)

  it('keeps a claim whose panel beat landed before this host held the session', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    rig.bus.heldMs.set(SESSION, 60_000)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()

    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'assistant-said').length === 1,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([SESSION])
    expect(rig.runtimes[0]?.released).toBe(false)
  }, 15_000)

  it('releases a claim when no panel hold is published for the session', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()

    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'assistant-said').length === 1,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    const released = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(released).toBe(true)
    expect(rig.runtimes[0]?.released).toBe(true)
  }, 15_000)
})
