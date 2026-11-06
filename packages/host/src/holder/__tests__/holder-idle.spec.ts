import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

describe('SessionHolder idle release (F15)', () => {
  it('pending inbox input blocks the idle release', async () => {
    const rig = await makeRig({
      idleMinutes: 0.2,
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

  it('input posted during the release is claimed again without a wake', async () => {
    const rig = await makeRig({
      idleMinutes: 0.2,
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
    let wakesAfterPost = -1
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      await rig.post('late arrival')
      wakesAfterPost = rig.wakeCount(SESSION)
      return originalRevoke(params)
    }) as typeof rig.plane.revoke

    rig.clock.advance(13_000)
    const reclaimed = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 100,
    })
    expect(reclaimed).toBe(true)
    expect(rig.runtimes[0]?.released).toBe(true)
    expect(rig.wakeCount(SESSION)).toBe(wakesAfterPost)
    expect(rig.holder.heldIds().length).toBe(1)
  }, 15_000)

  it('a failing read after the release still ends the session and hands it back for a holder', async () => {
    const rig = await makeRig({
      idleMinutes: 0.2,
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
    let failing = true
    rig.plane.readInbox = (async (params: Parameters<typeof rig.plane.readInbox>[0]) => {
      if (failing && rig.runtimes[0]?.released === true) throw new Error('late read down')
      return original(params)
    }) as typeof rig.plane.readInbox

    rig.clock.advance(13_000)
    const ended = await flushUntil({
      check: async () => (await rig.plane.currentLease({ sessionId: SESSION })).lease.epoch > 1,
      attempts: 100,
    })
    expect(ended).toBe(true)
    failing = false
    expect(await flushUntil({ check: () => rig.runtimes.length === 2, attempts: 100 })).toBe(true)
  }, 15_000)
})
