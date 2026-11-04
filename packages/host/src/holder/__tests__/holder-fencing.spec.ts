import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const ttlMs = 30_000
const fenceMarginMs = 5_000
const renewEveryMs = 5_000

describe('SessionHolder self-fence (F7)', () => {
  it('a renew that never settles self-fences at ttl−margin on the fake clock', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    await a.holder.start()
    await a.post('hello')
    await a.wake()
    const saw = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)
    expect(a.holder.heldIds().length).toBe(1)

    a.plane.renew = () => new Promise(() => {})

    a.clock.advance(ttlMs - fenceMarginMs + renewEveryMs)
    const dropped = await flushUntil({ check: () => a.holder.heldIds().length === 0 })
    expect(dropped).toBe(true)
  }, 15_000)

  it('during an active turn, no append lands after the fence deadline', async () => {
    const a = await makeRig({
      holderId: 'holder-a',
      script: [
        {
          calls: [
            {
              callId: 'call-1',
              name: 'bash',
              input: { command: 'echo started; sleep 600; echo late' },
            },
          ],
        },
        { text: 'after' },
      ],
    })
    await seedSession(a)
    await a.holder.start()
    await a.post('run')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    a.plane.renew = () => new Promise(() => {})
    const seqBefore = (await a.events()).length

    a.clock.advance(ttlMs - fenceMarginMs + renewEveryMs)
    const dropped = await flushUntil({ check: () => a.holder.heldIds().length === 0 })
    expect(dropped).toBe(true)

    const after = await a.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 1000,
      visible: false,
    })
    expect(after.events.length).toBe(seqBefore)
  }, 15_000)

  it('when renew always fails the holder self-fences and no append lands after B claims', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    await a.holder.start()
    await a.post('hello')
    await a.wake()
    const saw = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    const originalRenew = a.plane.renew.bind(a.plane)
    a.plane.renew = () => Promise.reject(new Error('network down'))

    const dropped = await flushUntil({
      check: () => a.holder.heldIds().length === 0,
      clock: a.clock,
      advanceMs: 5_000,
      attempts: 20,
    })
    expect(dropped).toBe(true)

    const seqBefore = (await a.events()).length
    a.plane.renew = originalRenew

    a.clock.advance(10_000)
    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'took over' }],
    })
    await b.holder.start()
    await a.bus.wake(SESSION)
    const claimed = await flushUntil({ check: () => b.holder.heldIds().length === 1 })
    expect(claimed).toBe(true)

    const lease = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderId).toBe('holder-b')

    const staleAppend = await a.plane.append({
      threadId: 'thread-rig' as never,
      epoch: 1,
      events: [],
    })
    expect(staleAppend.ok).toBe(false)
    expect((await a.events()).length).toBe(seqBefore)
  }, 15_000)
})

describe('SessionHolder zombie (F16)', () => {
  it('a zombie holder that keeps writing after B claims is refused and drops the session', async () => {
    const a = await makeRig({ holderId: 'holder-a' })
    await seedSession(a)
    await a.holder.start()
    await a.post('start')
    await a.wake()
    const saw = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
      clock: a.clock,
      advanceMs: 5_000,
    })
    expect(saw).toBe(true)
    const epochA = (await a.plane.currentLease({ sessionId: SESSION })).lease.epoch

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'b turn' }],
    })
    await b.holder.start()
    const stolen = await a.plane.grant({ sessionId: SESSION, holderId: 'holder-b', ttlMs: 30_000 })
    expect(stolen.epoch).toBe(epochA + 1)

    const zombie = await a.plane.append({
      threadId: 'thread-rig' as never,
      epoch: epochA,
      events: [],
    })
    expect(zombie.ok).toBe(false)
    if (!zombie.ok) expect(zombie.refusal.kind).toBe('stale-epoch')

    const dropped = await flushUntil({
      check: () => a.holder.heldIds().length === 0,
      clock: a.clock,
      advanceMs: 5_000,
      attempts: 20,
    })
    expect(dropped).toBe(true)
  }, 15_000)
})
