import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

describe('SessionHolder claim', () => {
  it('two holders get the same wake; exactly one runs the turn', async () => {
    const a = await makeRig({})
    await seedSession(a)
    const b = await makeRig({
      plane: a.plane,
      store: a.store,
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
    const holderHostId = leases.lease.holderHostId ?? -1
    expect([a.hostId(), b.hostId()].includes(holderHostId)).toBe(true)
    expect(leases.live).toBe(true)

    const winner = leases.lease.holderHostId === a.hostId() ? a : b
    const loser = leases.lease.holderHostId === a.hostId() ? b : a
    expect(winner.runtimes.length).toBe(1)
    expect(loser.runtimes.length).toBe(0)
  })

  it('a live lease is never stolen', async () => {
    const a = await makeRig({})
    await seedSession(a)
    await a.holder.start()
    await postAndRun(a, 'first')
    await flushUntil({
      check: async () => (await a.events()).some((e) => e.type === 'assistant-said'),
    })

    const before = await a.plane.currentLease({ sessionId: SESSION })
    expect(before.lease.holderHostId).toBe(a.hostId())
    const epoch = before.lease.epoch

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
    })
    await b.holder.start()
    await a.bus.wake(SESSION)
    await a.flush()

    const after = await a.plane.currentLease({ sessionId: SESSION })
    expect(after.lease.holderHostId).toBe(a.hostId())
    expect(after.lease.epoch).toBe(epoch)
    expect(b.runtimes.length).toBe(0)
  })

  it('a lost wake is picked up by a later wake', async () => {
    const a = await makeRig({})
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

  it('maxSessions=1 with two concurrent wakes issues exactly one claim', async () => {
    const a = await makeRig({ maxSessions: 1 })
    await seedSession(a)
    await a.holder.start()

    let claimCalls = 0
    const originalClaim = a.plane.claim.bind(a.plane)
    a.plane.claim = async (params) => {
      claimCalls += 1
      return originalClaim(params)
    }

    await a.post('one')
    const first = a.bus.wake(SESSION)
    const second = a.bus.wake(SESSION)
    await Promise.all([first, second])
    const saw = await flushUntil({
      check: async () => (await a.events()).some((e) => e.type === 'assistant-said'),
    })
    expect(saw).toBe(true)
    expect(claimCalls).toBe(1)
    expect(a.runtimes.length).toBe(1)
  })

  it('a wake arriving during drain starts nothing', async () => {
    const a = await makeRig({ maxSessions: 1 })
    await seedSession(a)
    await a.holder.start()
    await postAndRun(a, 'first')
    await flushUntil({
      check: async () => (await a.events()).some((e) => e.type === 'assistant-said'),
    })
    expect(a.runtimes.length).toBe(1)

    const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
    a.clock.advance(1_100)
    await a.bus.wake(SESSION)
    await drain
    await a.flush()

    expect(a.runtimes.length).toBe(1)
    expect(a.holder.heldIds().length).toBe(0)
  })
})
