import { describe, expect, it } from 'bun:test'

import type { V2Event } from '@dltech/atlas-core'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, THREAD_ID } from './holder-rig'

const fullEvents = async (rig: {
  plane: {
    readEvents: (args: {
      threadId: typeof THREAD_ID
      afterSeq: number
      limit: number
      visible: boolean
    }) => Promise<{ events: V2Event[] }>
  }
}): Promise<V2Event[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return page.events
}

const retryFacts = (events: readonly V2Event[]) =>
  events.filter(
    (event): event is Extract<V2Event, { type: 'fact-recorded' }> =>
      event.type === 'fact-recorded' && event.key.startsWith('retry:'),
  )

const notBeforeOf = (fact: V2Event): number => {
  if (fact.type !== 'fact-recorded') throw new Error('not a fact')
  const value = fact.value
  if (typeof value !== 'object' || value === null || !('notBefore' in value)) {
    throw new Error('retry fact without notBefore')
  }
  return Date.parse(String(value.notBefore))
}

describe('holder retry deadlines', () => {
  it('a handoff shorter than the backoff revokes and wakes; B waits out the deadline', async () => {
    const a = await makeRig({
      holderId: 'holder-a',
      script: [{ throws: new Error('transient boom') }],
    })
    await seedSession(a)
    await a.holder.start()
    await postAndRun(a, 'hello')

    const recorded = await flushUntil({
      check: async () => retryFacts(await fullEvents(a)).length > 0,
    })
    expect(recorded).toBe(true)
    const fact = retryFacts(await fullEvents(a))[0]
    if (fact === undefined) throw new Error('no retry fact')
    const notBeforeMs = notBeforeOf(fact)
    expect(notBeforeMs).toBeGreaterThan(a.clock.now())

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'b answer' }],
    })
    await b.holder.start()

    const wakesBefore = a.bus.wakes.length
    const drain = a.holder.drain({ deadline: a.clock.now() + 100 })
    a.clock.advance(200)
    await drain

    expect((await a.events()).some((event) => event.type === 'run-failed')).toBe(false)
    expect(a.bus.wakes.length).toBeGreaterThan(wakesBefore)

    const claimed = await flushUntil({ check: () => b.holder.heldIds().length === 1 })
    expect(claimed).toBe(true)
    const lease = await b.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderId).toBe('holder-b')
    expect(lease.lease.epoch).toBeGreaterThan(1)

    const runtimeB = b.runtimes[0]
    if (runtimeB === undefined) throw new Error('no runtime for b')
    expect(runtimeB.model.requests).toHaveLength(0)

    while (a.clock.now() < notBeforeMs) {
      a.clock.advance(Math.min(100, notBeforeMs - a.clock.now()))
      await b.flush()
      if (a.clock.now() < notBeforeMs) expect(runtimeB.model.requests).toHaveLength(0)
    }
    const called = await flushUntil({ check: () => runtimeB.model.requests.length > 0 })
    expect(called).toBe(true)
    expect(a.clock.now()).toBeGreaterThanOrEqual(notBeforeMs)

    expect(retryFacts(await fullEvents(a)).filter((event) => event.key === fact.key)).toHaveLength(
      1,
    )
    const answered = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(answered).toBe(true)
  }, 20_000)
})
