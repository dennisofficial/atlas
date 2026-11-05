import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

const answered = async (rig: HolderRig): Promise<boolean> =>
  (await rig.events()).some((event) => event.type === 'assistant-said')

const holderOf = async (rig: HolderRig): Promise<number | null> =>
  (await rig.plane.currentLease({ sessionId: SESSION })).lease.holderHostId

const idleRig = async (): Promise<HolderRig> => {
  const rig = await makeRig({ idleMinutes: 0.2 })
  await seedSession(rig)
  await rig.holder.start()
  await rig.post('hello')
  await rig.wake()
  const saw = await flushUntil({ check: () => answered(rig), clock: rig.clock, advanceMs: 2_000 })
  expect(saw).toBe(true)
  return rig
}

const tickUntil = async (rig: HolderRig, check: () => Promise<boolean> | boolean) => {
  for (let i = 0; i < 300; i += 1) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 0))
    rig.clock.advance(5_000)
  }
  return check()
}

const advanceUntil = async (rig: HolderRig, check: () => Promise<boolean> | boolean) =>
  flushUntil({ check, clock: rig.clock, advanceMs: 2_000, attempts: 300 })

describe('SessionHolder settles the lease on every exit', () => {
  it('a turn that faults out of the loop revokes, stops the runtime and recovers (F28)', async () => {
    let broken = true
    const rig = await makeRig({
      model: () =>
        ({
          identity: { id: 'faulty', modelId: 'faulty-1' },
          step: async () => {
            if (broken) throw new Error('boom')
            return { parts: [{ type: 'text', text: 'ok' }], toolCalls: [], finishReason: 'stop' }
          },
        }) as never,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('first')
    await rig.wake()

    const settled = await tickUntil(rig, () => rig.runtimes[0]?.stopped === true)
    expect(settled).toBe(true)
    const revoked = await tickUntil(
      rig,
      async () => (await rig.plane.currentLease({ sessionId: SESSION })).lease.epoch > 1,
    )
    expect(revoked).toBe(true)

    broken = false
    rig.clock.advance(31_000)
    await rig.post('second')
    await rig.wake()
    const recovered = await tickUntil(rig, () => answered(rig))
    expect(recovered).toBe(true)
  }, 20_000)

  it('an idle release whose runtime.release throws is retried until the lease is revoked (F29a)', async () => {
    const rig = await idleRig()
    const runtime = rig.runtimes[0]
    if (runtime === undefined) throw new Error('no runtime')
    const original = runtime.release
    let failed = 0
    runtime.release = async () => {
      if (failed === 0) {
        failed += 1
        throw new Error('sandbox stop failed')
      }
      return original()
    }

    rig.clock.advance(13_000)
    const revoked = await advanceUntil(rig, async () => (await holderOf(rig)) === null)
    expect(failed).toBe(1)
    expect(revoked).toBe(true)
    expect(runtime.released).toBe(true)

    await rig.post('later')
    await rig.wake()
    const answeredAgain = await advanceUntil(
      rig,
      async () => (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
    )
    expect(answeredAgain).toBe(true)
  }, 20_000)

  it('an idle release whose revoke throws is retried until the lease is revoked (F29b)', async () => {
    const rig = await idleRig()
    const original = rig.plane.revoke.bind(rig.plane)
    let failed = 0
    rig.plane.revoke = (async (params: Parameters<typeof rig.plane.revoke>[0]) => {
      if (failed === 0) {
        failed += 1
        throw new Error('control plane down')
      }
      return original(params)
    }) as typeof rig.plane.revoke

    rig.clock.advance(13_000)
    const revoked = await advanceUntil(rig, async () => (await holderOf(rig)) === null)
    expect(failed).toBe(1)
    expect(revoked).toBe(true)

    await rig.post('later')
    await rig.wake()
    const answeredAgain = await advanceUntil(
      rig,
      async () => (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
    )
    expect(answeredAgain).toBe(true)
  }, 20_000)
})
