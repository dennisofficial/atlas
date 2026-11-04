import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

describe('SessionHolder idle release (F15)', () => {
  it('pending inbox input blocks the idle release', async () => {
    const rig = await makeRig({
      holderId: 'holder-a',
      idleMinutes: 0.2,
      ttlMs: 300_000,
      renewEveryMs: 5_000,
      fenceMarginMs: 5_000,
    })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(saw).toBe(true)
    expect(rig.holder.heldIds().length).toBe(1)

    const posted = rig.post('waiting input')
    rig.clock.advance(13_000)
    await posted
    await rig.flush()
    expect(rig.holder.heldIds().length).toBe(1)
    expect(rig.runtimes[0]?.released).toBe(false)
  }, 15_000)

  it('input posted during the release re-wakes the session after revoke', async () => {
    const rig = await makeRig({
      holderId: 'holder-a',
      idleMinutes: 0.2,
      ttlMs: 300_000,
      renewEveryMs: 5_000,
      fenceMarginMs: 5_000,
    })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(saw).toBe(true)

    const originalRevoke = rig.plane.revoke.bind(rig.plane)
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      await rig.post('late arrival')
      return originalRevoke(params)
    }) as typeof rig.plane.revoke

    const wakesBefore = rig.wakeCount(SESSION)
    rig.clock.advance(13_000)
    const released = await flushUntil({
      check: () => rig.runtimes[0]?.released === true,
      attempts: 100,
    })
    expect(released).toBe(true)
    expect(rig.wakeCount(SESSION)).toBeGreaterThan(wakesBefore)
    await rig.bus.wake(SESSION)
    const reclaimed = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 100,
    })
    expect(reclaimed).toBe(true)
    expect(rig.holder.heldIds().length).toBe(1)
  }, 15_000)

  it('a failing late read still ends the session, sends a wake and arms no timer', async () => {
    const rig = await makeRig({
      holderId: 'holder-a',
      idleMinutes: 0.2,
      ttlMs: 300_000,
      renewEveryMs: 5_000,
      fenceMarginMs: 5_000,
    })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(saw).toBe(true)

    const original = rig.plane.readInbox.bind(rig.plane)
    rig.plane.readInbox = (async (params: Parameters<typeof rig.plane.readInbox>[0]) => {
      if (rig.runtimes[0]?.released === true) throw new Error('late read down')
      return original(params)
    }) as typeof rig.plane.readInbox

    const wakesBefore = rig.wakeCount(SESSION)
    rig.clock.advance(13_000)
    const ended = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      attempts: 100,
    })
    expect(ended).toBe(true)
    expect(rig.wakeCount(SESSION)).toBeGreaterThan(wakesBefore)
    expect(rig.clock.pendingWithin(Number.MAX_SAFE_INTEGER)).toBe(false)
  }, 15_000)

  it('a holder that self-fenced can claim again on a later wake', async () => {
    const a = await makeRig({ holderId: 'holder-a', maxSessions: 1 })
    await seedSession(a)
    await a.holder.start()
    await postAndRun(a, 'first')
    const saw = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
      clock: a.clock,
      advanceMs: 2_000,
    })
    expect(saw).toBe(true)

    const originalRenew = a.plane.renew.bind(a.plane)
    a.plane.renew = () => Promise.reject(new Error('network down'))
    const dropped = await flushUntil({
      check: () => a.holder.heldIds().length === 0,
      clock: a.clock,
      advanceMs: 5_000,
      attempts: 20,
    })
    expect(dropped).toBe(true)
    a.plane.renew = originalRenew
    a.clock.advance(31_000)

    await a.post('second')
    await a.bus.wake(SESSION)
    const reclaimed = await flushUntil({
      check: async () =>
        (await a.events()).filter((event) => event.type === 'assistant-said').length === 2,
      clock: a.clock,
      advanceMs: 5_000,
      attempts: 50,
    })
    expect(reclaimed).toBe(true)
    expect(a.holder.heldIds().length).toBe(1)
    expect(a.runtimes.length).toBe(2)
  }, 15_000)
})
