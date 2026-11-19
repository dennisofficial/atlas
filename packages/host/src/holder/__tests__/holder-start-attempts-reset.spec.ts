import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, type HolderRig } from './holder-rig'

const setAttempts = async (rig: HolderRig, attempts: number): Promise<void> => {
  await rig.store.transact(async (tx) => {
    const lease = await tx.lockLease(SESSION)
    if (lease === undefined) throw new Error('the session has no lease')
    await tx.writeLease({
      lease: { ...lease, attempts, retryAfter: new Date(0).toISOString() },
      expectedEpoch: lease.epoch,
    })
  })
}

const turns = async (rig: HolderRig): Promise<number> =>
  (await rig.events()).filter((event) => event.type === 'assistant-said').length

const quarantined = async (rig: HolderRig): Promise<boolean> =>
  (await rig.events()).some((event) => event.type === 'session-start-failed')

describe('a take-over that reaches its first step', () => {
  it('forgets the failed starts of the host before it', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await setAttempts(rig, 4)

    await postAndRun(rig, 'hello')

    expect(
      await flushUntil({
        check: async () =>
          (await rig.plane.currentLease({ sessionId: SESSION })).lease.attempts === 0,
      }),
    ).toBe(true)
    const { lease } = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.retryAfter).toBeNull()
    expect(await quarantined(rig)).toBe(false)
  }, 15_000)

  it('clears the failed starts once the first step lands, without waiting for a release', async () => {
    const rig = await makeRig({ runningShells: async () => 1 })
    await seedSession(rig)
    await rig.holder.start()
    await setAttempts(rig, 4)

    await postAndRun(rig, 'hello')

    expect(
      await flushUntil({
        check: async () =>
          (await rig.plane.currentLease({ sessionId: SESSION })).lease.attempts === 0,
        clock: rig.clock,
        advanceMs: 200,
        attempts: 50,
      }),
    ).toBe(true)
    expect((await rig.plane.currentLease({ sessionId: SESSION })).lease.retryAfter).toBeNull()
    expect(rig.holder.heldIds()).toEqual([SESSION])
  }, 15_000)

  it('keeps the failed starts when the turn faults before appending a step', async () => {
    const rig = await makeRig({ script: [{ throws: new Error('the model fell over') }] })
    await seedSession(rig)
    await setAttempts(rig, 4)
    await rig.holder.start()

    await postAndRun(rig, 'hello')

    const cleared = await flushUntil({
      check: async () =>
        (await rig.plane.currentLease({ sessionId: SESSION })).lease.attempts === 0,
      clock: rig.clock,
      advanceMs: 200,
      attempts: 20,
    })
    expect(cleared).toBe(false)
    expect(await turns(rig)).toBe(0)
    expect((await rig.plane.currentLease({ sessionId: SESSION })).lease.attempts).toBeGreaterThan(0)
  }, 15_000)

  it('drained and taken over six times in a row never quarantines', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()

    for (let start = 1; start <= 6; start += 1) {
      await setAttempts(rig, 4)
      await postAndRun(rig, `turn ${start}`)
      expect(await flushUntil({ check: async () => (await turns(rig)) === start })).toBe(true)
    }

    expect(await quarantined(rig)).toBe(false)
  }, 30_000)
})
