import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, type HolderRig } from './holder-rig'

const failNeedingHolder = (rig: HolderRig, args: { failures: number }): { calls(): number } => {
  let calls = 0
  const original = rig.plane.sessionsNeedingHolder.bind(rig.plane)
  rig.plane.sessionsNeedingHolder = async (params) => {
    calls += 1
    if (calls <= args.failures) throw new Error('connection terminated unexpectedly')
    return original(params)
  }
  return { calls: () => calls }
}

describe('SessionHolder resync retry', () => {
  it('retries a failed needing-holder scan until it claims the waiting session', async () => {
    const rig = await makeRig({ script: [{ text: 'after resync' }] })
    await seedSession(rig)
    await rig.post('hello')
    const scan = failNeedingHolder(rig, { failures: 3 })
    await rig.holder.start()
    rig.bus.resync()

    const answered = await flushUntil({
      clock: rig.clock,
      advanceMs: 5_000,
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(answered).toBe(true)
    expect(scan.calls()).toBe(4)
  })

  it('failed resyncs share one retry timer', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    const scan = failNeedingHolder(rig, { failures: 2 })
    await rig.holder.start()
    rig.bus.resync()
    rig.bus.resync()
    await rig.flush()
    expect(scan.calls()).toBe(2)

    rig.clock.advance(250)
    await rig.flush()
    expect(scan.calls()).toBe(3)
    rig.clock.advance(60_000)
    await rig.flush()
    expect(scan.calls()).toBe(3)
  })

  it('drain cancels a pending retry', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    const scan = failNeedingHolder(rig, { failures: 1 })
    await rig.holder.start()
    rig.bus.resync()
    await rig.flush()
    expect(scan.calls()).toBe(1)

    await rig.holder.drain({ deadline: rig.clock.now() + 1_000 })
    expect(rig.clock.pendingWithin(60_000)).toBe(false)
    rig.clock.advance(60_000)
    await rig.flush()
    expect(scan.calls()).toBe(1)
    expect(rig.clock.pendingWithin(60_000)).toBe(false)
  })
})
