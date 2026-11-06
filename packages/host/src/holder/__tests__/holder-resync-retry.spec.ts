import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, type HolderRig } from './holder-rig'

const SWEEP_MS = 20_000

const failClaimNext = (rig: HolderRig, args: { failures: number }): { calls(): number } => {
  let calls = 0
  const original = rig.plane.claimNext.bind(rig.plane)
  rig.plane.claimNext = async (params) => {
    calls += 1
    if (calls <= args.failures) throw new Error('connection terminated unexpectedly')
    return original(params)
  }
  return { calls: () => calls }
}

describe('SessionHolder claim retry', () => {
  it('retries a failed claim on the next tick until it holds the waiting session', async () => {
    const rig = await makeRig({ script: [{ text: 'after resync' }], sweepMs: SWEEP_MS })
    await seedSession(rig)
    await rig.post('hello')
    const scan = failClaimNext(rig, { failures: 3 })
    await rig.holder.start()
    rig.bus.resync()

    const answered = await flushUntil({
      clock: rig.clock,
      advanceMs: SWEEP_MS,
      attempts: 100,
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(answered).toBe(true)
    expect(scan.calls()).toBeGreaterThanOrEqual(4)
  })

  it('failed claims do not retry between ticks', async () => {
    const rig = await makeRig({ sweepMs: SWEEP_MS })
    await seedSession(rig)
    const scan = failClaimNext(rig, { failures: 100 })
    await rig.holder.start()
    rig.bus.resync()
    await rig.flush()
    const afterRings = scan.calls()
    expect(afterRings).toBeLessThanOrEqual(2)

    rig.clock.advance(SWEEP_MS / 2)
    await rig.flush()
    expect(scan.calls()).toBe(afterRings)
    rig.clock.advance(SWEEP_MS)
    await rig.flush()
    expect(scan.calls()).toBe(afterRings + 1)
  })

  it('drain cancels the tick', async () => {
    const rig = await makeRig({ sweepMs: SWEEP_MS })
    await seedSession(rig)
    const scan = failClaimNext(rig, { failures: 1 })
    await rig.holder.start()
    rig.bus.resync()
    await rig.flush()
    const before = scan.calls()

    await rig.holder.drain({ deadline: rig.clock.now() + 1_000 })
    expect(rig.clock.pendingWithin(60_000)).toBe(false)
    rig.clock.advance(60_000)
    await rig.flush()
    expect(scan.calls()).toBe(before)
  })
})
