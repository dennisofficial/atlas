import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

const userSaid = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<number> =>
  (await rig.events()).filter((event) => event.type === 'user-said').length

const answered = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<boolean> =>
  (await rig.events()).some((event) => event.type === 'assistant-said')

describe('SessionHolder wake routing', () => {
  it('a held idle session takes a new message the moment the wake fires, with no timer advance', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => answered(rig),
    })
    expect(saw).toBe(true)

    await rig.post('follow up')
    await rig.bus.wake(SESSION)
    const replied = await flushUntil({
      check: async () => (await userSaid(rig)) === 2,
      attempts: 100,
    })
    expect(replied).toBe(true)
    expect(rig.clock.now()).toBe(0)
  }, 15_000)

  it('a resync re-reads the inbox of every held session', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => answered(rig),
    })
    expect(saw).toBe(true)

    await rig.post('missed wake')
    rig.bus.resync()
    const replied = await flushUntil({
      check: async () => (await userSaid(rig)) === 2,
      attempts: 100,
    })
    expect(replied).toBe(true)
  }, 15_000)

  it('a resync claims sessions that need a holder', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('orphaned')
    rig.bus.resync()
    const served = await flushUntil({
      check: async () => answered(rig),
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 100,
    })
    expect(served).toBe(true)
    expect(rig.runtimes.length).toBe(1)
    expect(
      (await rig.plane.currentLease({ sessionId: SESSION })).lease.attempts,
    ).toBeLessThanOrEqual(1)
  }, 15_000)

  it('a wake that lands during the release is claimed and runs exactly once', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    const originalRevoke = rig.plane.revoke.bind(rig.plane)
    let woken = false
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      if (!woken) {
        woken = true
        await rig.post('raced')
        await rig.bus.wake(SESSION)
      }
      return originalRevoke(params)
    }) as typeof rig.plane.revoke
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()

    const replied = await flushUntil({
      check: async () => (await userSaid(rig)) === 2,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(replied).toBe(true)
    await rig.flush()
    expect(await userSaid(rig)).toBe(2)
    expect(await rig.plane.currentLease({ sessionId: SESSION })).toMatchObject({
      lease: { holderHostId: null, wantsHolder: false },
    })
  }, 15_000)
})
