import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

const within = async (promise: Promise<unknown>, ms: number): Promise<boolean> =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])

describe('SessionHolder drain with a teardown that never settles', () => {
  it('hands the lease back without waiting for the runtime stop', async () => {
    const stopGate = new Promise<void>(() => {})
    const rig = await makeRig({ runningShells: async () => 1, stopGate })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const answered = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(answered).toBe(true)
    await rig.flush()
    expect(rig.holder.heldIds()).toEqual([SESSION])

    expect(await within(rig.holder.drain(), 500)).toBe(true)

    const { lease } = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease).toMatchObject({ holderHostId: null, wantsHolder: false })
    expect(rig.runtimes[0]?.stopped).toBe(false)
  }, 15_000)
})
