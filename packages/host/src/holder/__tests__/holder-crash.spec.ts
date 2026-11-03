import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

const longExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 600; echo late' } },
    ],
  },
  { text: 'after crash' },
] as const

const leaseExpiry = 31_000

const crashA = async (a: HolderRig): Promise<void> => {
  const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
  a.clock.advance(1_100)
  await drain
}

describe('SessionHolder crash (F11/F13/F14)', () => {
  it('a crashed holder leaves the lease to expire; B claims and collects the exec once', async () => {
    const a = await makeRig({ holderId: 'holder-a', script: longExecScript })
    await seedSession(a)
    await a.holder.start()
    await a.post('long exec')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    expect(a.daemon.runCount()).toBe(1)

    await crashA(a)
    a.clock.advance(leaseExpiry)

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'collected' }],
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    const settled = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
    })
    expect(settled).toBe(true)
    expect(a.daemon.runCount()).toBe(1)
    const results = (await a.events()).filter((event) => event.type === 'tool-result')
    expect(results.length).toBe(1)
  }, 15_000)

  it('a dispatched call the daemon never ran is run exactly once by B', async () => {
    const a = await makeRig({ holderId: 'holder-a', script: longExecScript })
    await seedSession(a)
    await a.holder.start()
    await a.post('dispatched but never run')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    await crashA(a)
    a.clock.advance(leaseExpiry)

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'rerun done' }],
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    const settled = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
    })
    expect(settled).toBe(true)
    const results = (await a.events()).filter((event) => event.type === 'tool-result')
    expect(results.length).toBe(1)
  }, 15_000)

  it('after a daemon restart a bash call becomes interrupted', async () => {
    const a = await makeRig({ holderId: 'holder-a', script: longExecScript })
    await seedSession(a)
    await a.holder.start()
    await a.post('exec then restart')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    const bootBefore = a.daemon.bootId()

    await crashA(a)
    await a.daemon.restart()
    expect(a.daemon.bootId()).not.toBe(bootBefore)
    a.clock.advance(leaseExpiry)

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'recovered' }],
    })
    await b.holder.start()
    await a.bus.wake(SESSION)

    const settled = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
    })
    expect(settled).toBe(true)
    const result = (await a.events()).find((event) => event.type === 'tool-result')
    expect(result).toBeDefined()
  }, 15_000)
})
