import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

const answers = async (rig: HolderRig): Promise<number> =>
  (await rig.events()).filter((event) => event.type === 'assistant-said').length

const leaseOf = async (rig: HolderRig) =>
  (await rig.plane.currentLease({ sessionId: SESSION })).lease

const advanceUntil = (rig: HolderRig, check: () => Promise<boolean> | boolean) =>
  flushUntil({ check, clock: rig.clock, advanceMs: 2_000, attempts: 200 })

const revokeLikeWake = async (rig: HolderRig): Promise<void> => {
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
  await rig.bus.wake(SESSION)
}

const settledFree = async (rig: HolderRig): Promise<boolean> => {
  const lease = await leaseOf(rig)
  return rig.holder.heldIds().length === 0 && lease.holderHostId === null && !lease.wantsHolder
}

const expectStillServed = async (rig: HolderRig, before: number): Promise<void> => {
  await rig.post('after the race')
  await rig.wake()
  expect(await advanceUntil(rig, async () => (await answers(rig)) === before + 1)).toBe(true)
  expect(await advanceUntil(rig, () => settledFree(rig))).toBe(true)
}

describe('SessionHolder idle release raced by an unguarded wake revoke', () => {
  it('reclaims the session when the revoke lands before the release reads the lease', async () => {
    const rig = await makeRig({ script: [{ text: 'one' }, { text: 'two' }] })
    await seedSession(rig)
    const original = rig.plane.currentLease.bind(rig.plane)
    let raced = false
    rig.plane.currentLease = async (params: { sessionId: string }) => {
      if (!raced && rig.holder.heldIds().includes(SESSION) && (await answers(rig)) === 1) {
        raced = true
        await revokeLikeWake(rig)
      }
      return original(params)
    }
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()

    expect(await advanceUntil(rig, () => raced && rig.runtimes.length === 2)).toBe(true)
    expect(await advanceUntil(rig, () => settledFree(rig))).toBe(true)
    await expectStillServed(rig, 1)
  }, 20_000)

  it('reclaims the session when the revoke lands after the release read the lease', async () => {
    const rig = await makeRig({ script: [{ text: 'one' }, { text: 'two' }] })
    await seedSession(rig)
    const original = rig.plane.currentLease.bind(rig.plane)
    let raced = false
    rig.plane.currentLease = async (params: { sessionId: string }) => {
      const read = await original(params)
      if (!raced && rig.holder.heldIds().includes(SESSION) && (await answers(rig)) === 1) {
        raced = true
        await revokeLikeWake(rig)
      }
      return read
    }
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()

    expect(await advanceUntil(rig, () => raced && rig.runtimes[0]?.released === true)).toBe(true)
    expect(await advanceUntil(rig, () => settledFree(rig))).toBe(true)
    await expectStillServed(rig, 1)
  }, 20_000)

  it('reclaims the session when the host claims it again while the fenced holder still settles', async () => {
    const rig = await makeRig({ script: [{ text: 'one' }, { text: 'two' }] })
    await seedSession(rig)
    const originalLease = rig.plane.currentLease.bind(rig.plane)
    let racedEpoch: number | undefined
    rig.plane.currentLease = async (params: { sessionId: string }) => {
      if (racedEpoch === undefined && (await answers(rig)) === 1) {
        racedEpoch = (await originalLease(params)).lease.epoch
        await revokeLikeWake(rig)
      }
      return originalLease(params)
    }
    const originalRevoke = rig.plane.revoke.bind(rig.plane)
    let openSettle!: () => void
    const settleGate = new Promise<void>((resolve) => (openSettle = resolve))
    let settling = false
    rig.plane.revoke = (async (params: Parameters<typeof originalRevoke>[0]) => {
      if (params.epoch !== undefined && params.epoch === racedEpoch) {
        settling = true
        await settleGate
      }
      return originalRevoke(params)
    }) as typeof rig.plane.revoke
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    expect(await flushUntil({ check: () => settling, clock: rig.clock, attempts: 200 })).toBe(true)

    rig.holder.ring()
    expect(await flushUntil({ check: () => rig.runtimes.length === 2, attempts: 200 })).toBe(true)
    openSettle()

    expect(await advanceUntil(rig, () => settledFree(rig))).toBe(true)
    await expectStillServed(rig, 1)
  }, 20_000)
})
