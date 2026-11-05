import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

const idleRig = async (): Promise<HolderRig> => {
  const a = await makeRig({})
  await seedSession(a)
  await a.holder.start()
  await a.post('hello')
  await a.wake()
  const saw = await flushUntil({
    check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
  })
  expect(saw).toBe(true)
  return a
}

const makeB = (a: HolderRig): Promise<HolderRig> =>
  makeRig({
    plane: a.plane,
    store: a.store,
    bus: a.bus,
    clock: a.clock,
    daemon: a.daemon,
    script: [{ text: 'b says hi' }],
  })

describe('SessionHolder drain of an idle session', () => {
  it('revokes without wantsHolder, sends no wake and leaves the session unclaimed', async () => {
    const a = await idleRig()
    const b = await makeB(a)
    await b.holder.start()
    const wakesBefore = a.wakeCount(SESSION)

    await a.holder.drain({ deadline: a.clock.now() + 30_000 })
    await a.flush()

    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
    expect(lease.wantsHolder).toBe(false)
    expect(a.wakeCount(SESSION)).toBe(wakesBefore)
    expect(b.holder.heldIds().length).toBe(0)
    expect(b.runtimes.length).toBe(0)
    expect(await a.plane.sessionsNeedingHolder({ limit: 10 })).toEqual([])
  }, 15_000)

  it('a message after the drain wakes the next holder, which claims it', async () => {
    const a = await idleRig()
    const b = await makeB(a)
    await b.holder.start()
    await a.holder.drain({ deadline: a.clock.now() + 30_000 })

    await a.post('after the deploy')
    await a.wake()
    const answered = await flushUntil({
      check: async () =>
        (await a.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(b.holder.heldIds().length).toBe(1)
  }, 15_000)

  it('a message posted while the drain revokes is woken and claimed promptly', async () => {
    const a = await idleRig()
    const b = await makeB(a)
    await b.holder.start()

    const originalRevoke = a.plane.revoke.bind(a.plane)
    let wakesAfterPost = 0
    a.plane.revoke = (async (params: Parameters<typeof a.plane.revoke>[0]) => {
      await a.post('posted during the drain')
      wakesAfterPost = a.wakeCount(SESSION)
      return originalRevoke(params)
    }) as typeof a.plane.revoke

    await a.holder.drain({ deadline: a.clock.now() + 30_000 })
    await a.flush()
    expect(wakesAfterPost).toBeGreaterThan(0)
    expect(a.wakeCount(SESSION)).toBeGreaterThan(wakesAfterPost)

    await a.wake()
    const answered = await flushUntil({
      check: async () =>
        (await a.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(b.holder.heldIds().length).toBe(1)
  }, 15_000)
})
