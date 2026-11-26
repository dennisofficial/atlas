import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, type HolderRig } from './holder-rig'

const settleFirstTurn = async (rig: HolderRig): Promise<void> => {
  await seedSession(rig)
  await rig.holder.start()
  await postAndRun(rig, 'hello')
  const saw = await flushUntil({
    check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    clock: rig.clock,
    advanceMs: 2_000,
  })
  expect(saw).toBe(true)
}

const releasedWithin = (rig: HolderRig): Promise<boolean> =>
  flushUntil({
    check: () => rig.runtimes[0]?.released === true,
    attempts: 100,
    clock: rig.clock,
    advanceMs: 1_000,
  })

describe('SessionHolder on a parked session', () => {
  it('releases an idle session with an open shell once the operator parks the pod', async () => {
    const rig = await makeRig({ runningShells: async () => 1 })
    await settleFirstTurn(rig)
    await rig.flush()
    expect(rig.runtimes[0]?.released).toBe(false)
    expect(rig.holder.heldIds()).toEqual([SESSION])

    await rig.plane.parkPod({ sessionId: SESSION })
    await rig.wake()

    expect(await releasedWithin(rig)).toBe(true)
    expect(rig.holder.heldIds().length).toBe(0)
  }, 15_000)

  it('does not take a parked session back for a panel hold', async () => {
    const rig = await makeRig({})
    await settleFirstTurn(rig)
    await rig.plane.parkPod({ sessionId: SESSION })
    await rig.wake()
    expect(await releasedWithin(rig)).toBe(true)

    rig.bus.deliverPanelHold({ sessionId: SESSION, ttlMs: 60_000 })
    await rig.flush()
    await rig.wake()
    await rig.flush()

    expect(rig.holder.heldIds().length).toBe(0)
    expect(rig.runtimes.length).toBe(1)
  }, 15_000)

  it('starts a turn again for a message posted after the park', async () => {
    const rig = await makeRig({})
    await settleFirstTurn(rig)
    await rig.plane.parkPod({ sessionId: SESSION })
    await rig.wake()
    expect(await releasedWithin(rig)).toBe(true)

    await postAndRun(rig, 'again')

    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'assistant-said').length === 2,
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(rig.runtimes.length).toBe(2)
    expect((await rig.plane.readSession({ sessionId: SESSION }))?.podParkedAt).toBeNull()
  }, 20_000)
})
