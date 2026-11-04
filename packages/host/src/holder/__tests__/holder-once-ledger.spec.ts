import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, THREAD_ID } from './holder-rig'
import { V2OnceLedger } from '../record/v2-once-ledger'
import { SessionRecord } from '../record/record-adapter'

describe('SessionHolder OnceLedger', () => {
  it('a retry deadline recorded by A is read back by B', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    await a.holder.start()
    await postAndRun(a, 'hello')
    const saw = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    const runtimeA = a.runtimes[0]
    if (runtimeA === undefined) throw new Error('no runtime')
    const leaseA = await a.plane.currentLease({ sessionId: SESSION })
    const recordA = await SessionRecord.open({
      plane: a.plane,
      threadId: THREAD_ID,
      epoch: leaseA.lease.epoch,
      timers: a.clock,
      remoteCalls: runtimeA.remoteCalls,
      daemonTools: runtimeA.daemonTools,
      nowIso: () => new Date(a.clock.now()).toISOString(),
    })
    const ledgerA = new V2OnceLedger({
      cache: recordA.eventCache(),
      record: recordA,
      threadId: THREAD_ID,
      runId: () => a.ids.nextRunId(),
    })
    const notBefore = a.clock.now() + 60_000
    const first = await ledgerA.once({
      key: 'retry:model',
      decide: () => Promise.resolve(notBefore),
    })
    expect(first).toBe(notBefore)
    const factEvents = (await a.events()).filter((event) => event.type === 'fact-recorded')
    expect(factEvents.length).toBe(1)

    const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
    a.clock.advance(1_100)
    await drain

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'b turn' }],
    })
    await b.holder.start()
    await a.bus.wake(SESSION)
    const claimed = await flushUntil({ check: () => b.holder.heldIds().length === 1 })
    expect(claimed).toBe(true)

    const runtimeB = b.runtimes[0]
    if (runtimeB === undefined) throw new Error('no runtime for b')
    const leaseB = await b.plane.currentLease({ sessionId: SESSION })
    const recordB = await SessionRecord.open({
      plane: b.plane,
      threadId: THREAD_ID,
      epoch: leaseB.lease.epoch,
      timers: b.clock,
      remoteCalls: runtimeB.remoteCalls,
      daemonTools: runtimeB.daemonTools,
      nowIso: () => new Date(b.clock.now()).toISOString(),
    })
    const ledgerB = new V2OnceLedger({
      cache: recordB.eventCache(),
      record: recordB,
      threadId: THREAD_ID,
      runId: () => b.ids.nextRunId(),
    })
    let decided = 0
    const readBack = await ledgerB.once({
      key: 'retry:model',
      decide: () => {
        decided += 1
        return Promise.resolve(-1)
      },
    })
    expect(decided).toBe(0)
    expect(readBack).toBe(notBefore)
    expect((await a.events()).filter((event) => event.type === 'fact-recorded').length).toBe(1)
  }, 15_000)
})
