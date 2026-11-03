import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

describe('SessionHolder claim', () => {
  it('two holders get the same wake; exactly one runs the turn', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
    })
    await a.holder.start()
    await b.holder.start()

    await a.post('hello')
    await a.bus.wake(SESSION)
    const sawEvents = await flushUntil({
      check: async () => (await a.events()).some((e) => e.type === 'assistant-said'),
    })
    expect(sawEvents).toBe(true)

    const leases = await a.plane.currentLease({ sessionId: SESSION })
    const holderId = leases.lease.holderId ?? 'nobody'
    expect(['holder-a', 'holder-b'].includes(holderId)).toBe(true)
    expect(leases.live).toBe(true)

    const winner = leases.lease.holderId === 'holder-a' ? a : b
    const loser = leases.lease.holderId === 'holder-a' ? b : a
    expect(winner.runtimes.length).toBe(1)
    expect(loser.runtimes.length).toBe(0)
  })

  it('a live lease is never stolen', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    await a.holder.start()
    await postAndRun(a, 'first')
    await flushUntil({
      check: async () => (await a.events()).some((e) => e.type === 'assistant-said'),
    })

    const before = await a.plane.currentLease({ sessionId: SESSION })
    expect(before.lease.holderId).toBe('holder-a')
    const epoch = before.lease.epoch

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
    })
    await b.holder.start()
    await a.bus.wake(SESSION)
    await a.flush()

    const after = await a.plane.currentLease({ sessionId: SESSION })
    expect(after.lease.holderId).toBe('holder-a')
    expect(after.lease.epoch).toBe(epoch)
    expect(b.runtimes.length).toBe(0)
  })

  it('a lost wake is picked up by a later wake', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    await a.post('lost then found')

    await a.bus.wake(SESSION)
    expect(a.runtimes.length).toBe(0)

    await a.holder.start()
    await a.bus.wake(SESSION)
    const saw = await flushUntil({
      check: async () => (await a.events()).some((e) => e.type === 'assistant-said'),
    })
    expect(saw).toBe(true)
    expect(a.runtimes.length).toBe(1)
  })
})
