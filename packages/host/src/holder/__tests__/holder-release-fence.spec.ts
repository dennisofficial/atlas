import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

describe('SessionHolder releases what it cannot run', () => {
  it('a runtime that fails to start releases the lease and is retried after a backoff', async () => {
    let attempts = 0
    const rig = await makeRig({
      script: [{ text: 'second try' }],
      beforeRuntime: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('sandbox provider unavailable')
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    await rig.flush()
    expect(attempts).toBe(1)
    expect(rig.holder.heldIds()).toEqual([])
    expect((await rig.plane.currentLease({ sessionId: SESSION })).live).toBe(false)

    await rig.wake()
    await rig.flush()
    expect(attempts).toBe(1)

    const answered = await flushUntil({
      clock: rig.clock,
      advanceMs: 1_000,
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(answered).toBe(true)
    expect(attempts).toBe(2)
    expect((await rig.plane.currentLease({ sessionId: SESSION })).lease.epoch).toBe(3)
  })

  it('an idle holder whose epoch moved never revokes its successor', async () => {
    const a = await makeRig({ idleMinutes: 0.2 })
    await seedSession(a)
    await a.holder.start()
    await postAndRun(a, 'hello')
    const answered = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(answered).toBe(true)
    await a.flush()

    const thief = a.store.nextHostId()
    a.store.markHostPresent(thief)
    await a.plane.grant({ sessionId: SESSION, hostId: thief })
    const successor = await a.plane.currentLease({ sessionId: SESSION })

    a.clock.advance(13_000)
    expect(await flushUntil({ check: () => a.holder.heldIds().length === 0 })).toBe(true)
    await a.flush()

    const after = await a.plane.currentLease({ sessionId: SESSION })
    expect(after.lease.epoch).toBe(successor.lease.epoch)
    expect(after.lease.holderHostId).toBe(thief)
  })
})
