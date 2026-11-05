import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const longExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
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

const drainA = async (a: HolderRig): Promise<void> => {
  const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
  a.clock.advance(1_100)
  await drain
  await new Promise((resolve) => setTimeout(resolve, 1_000))
}

const claimWithB = async (a: HolderRig): Promise<HolderRig> => {
  const b = await makeRig({
    plane: a.plane,
    store: a.store,
    bus: a.bus,
    clock: a.clock,
    daemon: a.daemon,
    script: [{ text: 'collected' }],
  })
  await b.holder.start()
  await a.bus.wake(SESSION)
  return b
}

const toolResults = async (rig: HolderRig): Promise<unknown[]> => {
  const raw = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return raw.events.filter((event) => event.type === 'tool-result')
}

describe('SessionHolder handoff (F12/F15)', () => {
  it('drain hands a long exec to the next holder, which collects it without a second spawn', async () => {
    const a = await makeRig({ script: longExecScript })
    await seedSession(a)
    await a.holder.start()

    await a.post('run the long thing')
    await a.wake()
    expect(await startedExec(a)).toBe(true)
    expect(a.runtimes.length).toBe(1)

    await drainA(a)

    const leaseAfterDrain = await a.plane.currentLease({ sessionId: SESSION })
    expect(leaseAfterDrain.lease.holderHostId).toBeNull()
    expect(leaseAfterDrain.lease.wantsHolder).toBe(true)
    expect(a.wakeCount(SESSION)).toBeGreaterThanOrEqual(2)

    const b = await claimWithB(a)

    const done = await flushUntil({
      check: async () => (await toolResults(a)).length > 0,
      attempts: 200,
    })
    expect(done).toBe(true)

    const results = await toolResults(a)
    expect(results.length).toBe(1)
    expect(a.daemon.runCount()).toBe(1)
    expect(b.runtimes.length).toBe(1)
  }, 15_000)

  it('past the deadline a daemon tool wait detaches: no cancel, no record by A; B collects the successful result', async () => {
    const a = await makeRig({ script: longExecScript })
    await seedSession(a)
    await a.holder.start()

    await a.post('run the long thing')
    await a.wake()
    expect(await startedExec(a)).toBe(true)
    expect(a.daemon.runCount()).toBe(1)

    await drainA(a)
    expect((await toolResults(a)).length).toBe(0)

    const b = await claimWithB(a)

    const done = await flushUntil({
      check: async () => (await toolResults(a)).length > 0,
      attempts: 200,
    })
    expect(done).toBe(true)
    await flushUntil({ check: () => (b.runtimes[0]?.ackedScopes.length ?? 0) > 0 })

    const results = (await toolResults(a)) as { error?: unknown; epoch?: number }[]
    expect(results.length).toBe(1)
    expect(results[0]?.error).toBeUndefined()
    expect(a.daemon.runCount()).toBe(1)

    const epochB = (await a.plane.currentLease({ sessionId: SESSION })).lease.epoch
    expect((results[0] as { epoch: number }).epoch).toBe(epochB)
    expect(b.runtimes[0]?.ackedScopes.length).toBeGreaterThanOrEqual(1)
  }, 15_000)

  it('a holder whose drain revoke resolves after a successor claimed never revokes that successor', async () => {
    const a = await makeRig({ script: longExecScript })
    await seedSession(a)
    await a.holder.start()

    await a.post('run the long thing')
    await a.wake()
    expect(await startedExec(a)).toBe(true)

    const plane = a.plane
    const originalRevoke = plane.revoke.bind(plane)
    let firstRevoke: (() => void) | undefined
    plane.revoke = ((params: { sessionId: string; wantsHolder: boolean; epoch?: number }) => {
      if (firstRevoke !== undefined) {
        return originalRevoke(params as { sessionId: string; wantsHolder: boolean })
      }
      return new Promise<unknown>((resolve) => {
        firstRevoke = () => {
          resolve(undefined)
          void originalRevoke(params as { sessionId: string; wantsHolder: boolean })
        }
      })
    }) as typeof plane.revoke

    const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
    a.clock.advance(1_100)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(firstRevoke).toBeDefined()

    a.presence.lose()
    a.clock.advance(31_000)
    const b = await makeRig({
      plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'b' }],
    })
    await b.holder.start()
    a.clock.advance(31_000)
    await a.bus.wake(SESSION)
    const claimed = await flushUntil({
      check: () => b.holder.heldIds().length === 1,
      clock: a.clock,
      advanceMs: 31_000,
    })
    expect(claimed).toBe(true)

    firstRevoke?.()
    await drain
    await a.flush()

    const lease = await plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderHostId).toBe(b.hostId())
    plane.revoke = originalRevoke
  }, 15_000)
})

describe('SessionHolder drain while idle', () => {
  it('ends the session without waiting on a failing inbox read and resolves handoff', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    rig.plane.readInbox = () => Promise.reject(new Error('inbox down'))
    const draining = rig.holder.drain({ deadline: rig.clock.now() + 30_000 })
    const ended = await flushUntil({
      check: () => rig.holder.heldIds().length === 0,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(ended).toBe(true)
    await draining
  }, 15_000)
})
