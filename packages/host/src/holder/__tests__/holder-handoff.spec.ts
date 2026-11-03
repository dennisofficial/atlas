import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

const longExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 600; echo late' } },
    ],
  },
  { text: 'after handoff' },
] as const

const startedExec = async (rig: HolderRig): Promise<boolean> =>
  flushUntil({
    check: async () => {
      const events = await rig.events()
      return events.some((event) => event.type === 'tool-dispatched')
    },
  })

describe('SessionHolder handoff (F12/F15)', () => {
  it('drain hands a long exec to the next holder, which collects it without a second spawn', async () => {
    const a = await makeRig({ holderId: 'holder-a', script: longExecScript })
    await seedSession(a)
    await a.holder.start()

    await a.post('run the long thing')
    await a.wake()
    expect(await startedExec(a)).toBe(true)
    expect(a.runtimes.length).toBe(1)

    const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
    a.clock.advance(1_100)
    await drain

    const leaseAfterDrain = await a.plane.currentLease({ sessionId: SESSION })
    expect(leaseAfterDrain.lease.holderId).toBeNull()
    expect(leaseAfterDrain.lease.wantsHolder).toBe(true)
    expect(a.bus.wakes.filter((id) => id === SESSION).length).toBeGreaterThanOrEqual(2)

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

    const done = await flushUntil({
      check: async () => {
        const events = await a.events()
        return events.some((event) => event.type === 'tool-result')
      },
      attempts: 200,
    })
    expect(done).toBe(true)

    const events = await a.events()
    const results = events.filter((event) => event.type === 'tool-result')
    expect(results.length).toBe(1)
    expect(a.daemon.runCount()).toBe(1)
    expect(b.runtimes.length).toBe(1)
  }, 15_000)
})
