import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const longExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
    ],
  },
  { text: 'after crash' },
] as const

const leaseExpiry = 31_000

const crashA = async (a: HolderRig): Promise<void> => {
  a.holder.discard()
  a.presence.lose()
  await a.flush()
}

const hasInterruptedResult = async (rig: HolderRig, needle: string): Promise<boolean> => {
  const raw = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return raw.events.some(
    (event) => event.type === 'tool-result' && JSON.stringify(event).includes(needle),
  )
}

const claimWith = async (a: HolderRig, script: readonly { text: string }[]): Promise<HolderRig> => {
  a.clock.advance(leaseExpiry)
  const b = await makeRig({
    plane: a.plane,
    store: a.store,
    bus: a.bus,
    clock: a.clock,
    daemon: a.daemon,
    script,
  })
  await b.holder.start()
  await a.bus.wake(SESSION)
  const claimed = await flushUntil({ check: () => b.runtimes.length > 0, attempts: 200 })
  expect(claimed).toBe(true)
  return b
}

describe('SessionHolder crash (F11/F13/F14)', () => {
  it('a crashed holder leaves the lease to expire; B claims and collects the exec once', async () => {
    const a = await makeRig({ script: longExecScript })
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
    const b = await claimWith(a, [{ text: 'collected' }])
    expect(b.runtimes.length).toBeGreaterThan(0)

    const settled = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-result'),
      attempts: 600,
    })
    expect(settled).toBe(true)
    expect(a.daemon.runCount()).toBe(1)
    const results = (await a.events()).filter((event) => event.type === 'tool-result')
    expect(results.length).toBe(1)
  }, 15_000)

  it('a dispatched call the daemon never ran is run exactly once by B', async () => {
    const a = await makeRig({ script: longExecScript })
    await seedSession(a)
    await a.holder.start()
    await a.post('dispatched but never run')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    await crashA(a)
    await claimWith(a, [{ text: 'rerun done' }])

    const settled = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-result'),
      attempts: 600,
    })
    expect(settled).toBe(true)
    const results = (await a.events()).filter((event) => event.type === 'tool-result')
    expect(results.length).toBe(1)
  }, 15_000)

  it('after a daemon restart a bash call is reported interrupted', async () => {
    const stillRunning = [
      {
        calls: [{ callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 600' } }],
      },
      { text: 'after restart' },
    ] as const
    const a = await makeRig({ script: stillRunning })
    await seedSession(a)
    await a.holder.start()
    await a.post('exec then restart')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    const bootBefore = a.daemon.bootId()

    await a.daemon.restart()
    expect(a.daemon.bootId()).not.toBe(bootBefore)
    await crashA(a)
    a.clock.advance(leaseExpiry)

    const b = await claimWith(a, [{ text: 'recovered' }])
    expect(b.runtimes.length).toBeGreaterThan(0)

    const settled = await flushUntil({
      check: () => hasInterruptedResult(a, 'interrupted by a process restart'),
      attempts: 600,
    })
    expect(settled).toBe(true)
    const results = (await a.events()).filter((event) => event.type === 'tool-result')
    expect(results.length).toBe(1)
    expect((await a.events()).filter((event) => event.type === 'tool-dispatched').length).toBe(1)
  }, 15_000)
})
