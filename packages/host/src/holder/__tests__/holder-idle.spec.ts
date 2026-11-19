import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

const countOf = async (rig: Awaited<ReturnType<typeof makeRig>>, type: string): Promise<number> =>
  (await rig.events()).filter((event) => event.type === type).length

const saidByUser = (event: unknown): boolean =>
  typeof event === 'object' && event !== null && (event as { type?: unknown }).type === 'user-said'

describe('SessionHolder idle release (F15)', () => {
  it('pending inbox input keeps the session held and runs the next turn', async () => {
    const rig = await makeRig({ script: [{ text: 'one' }, { text: 'two' }] })
    await seedSession(rig)
    const originalAppend = rig.plane.append.bind(rig.plane)
    let posted = false
    rig.plane.append = (async (params: Parameters<typeof originalAppend>[0]) => {
      if (!posted && params.events.some(saidByUser)) {
        posted = true
        await rig.post('again')
      }
      return originalAppend(params)
    }) as typeof rig.plane.append
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const saw = await flushUntil({
      check: async () => (await countOf(rig, 'assistant-said')) === 2,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(saw).toBe(true)
    expect(posted).toBe(true)
    expect(rig.runtimes.length).toBe(1)
    const released = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(released).toBe(true)
    expect(rig.runtimes[0]?.released).toBe(true)
  }, 15_000)

  it('input posted during the release is claimed again without a wake', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    const originalRevoke = rig.plane.revoke.bind(rig.plane)
    let wakesAfterPost = -1
    let posted = false
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      if (!posted) {
        posted = true
        await rig.post('late arrival')
        wakesAfterPost = rig.wakeCount(SESSION)
      }
      return originalRevoke(params)
    }) as typeof rig.plane.revoke
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const reclaimed = await flushUntil({
      check: async () => (await countOf(rig, 'user-said')) === 2,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(reclaimed).toBe(true)
    await rig.flush()
    expect(await countOf(rig, 'user-said')).toBe(2)
    expect(wakesAfterPost).toBeGreaterThanOrEqual(0)
    expect(rig.wakeCount(SESSION)).toBe(wakesAfterPost)
    expect(rig.runtimes[0]?.released).toBe(true)
  }, 15_000)

  it('a failing read after the release still ends the session and hands it back for a holder', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    const original = rig.plane.readInbox.bind(rig.plane)
    let failing = true
    rig.plane.readInbox = (async (params: Parameters<typeof rig.plane.readInbox>[0]) => {
      if (failing && rig.runtimes[0]?.released === true) throw new Error('late read down')
      return original(params)
    }) as typeof rig.plane.readInbox
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    expect(await countOf(rig, 'assistant-said')).toBe(0)

    const answered = await flushUntil({
      check: async () => (await countOf(rig, 'assistant-said')) === 1,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    const ended = await flushUntil({
      check: async () => (await rig.plane.currentLease({ sessionId: SESSION })).lease.epoch > 1,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 100,
    })
    expect(ended).toBe(true)
    failing = false
    expect(await flushUntil({ check: () => rig.runtimes.length === 2, attempts: 100 })).toBe(true)

    await rig.post('recovered')
    await rig.wake()
    const served = await flushUntil({
      check: async () => (await countOf(rig, 'assistant-said')) === 2,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(served).toBe(true)
  }, 15_000)
})
