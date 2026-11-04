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

describe('holder retry deadlines', () => {
  it("B's first model call waits out the notBefore A recorded, recorded exactly once", async () => {
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
    const value = fact.value
    if (typeof value !== 'object' || value === null || !('notBefore' in value)) {
      throw new Error('retry fact without notBefore')
    }
    const notBeforeMs = Date.parse(String(value.notBefore))
    expect(Number.isFinite(notBeforeMs)).toBe(true)

    const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
    a.clock.advance(1_100)
    await drain
    a.clock.advance(31_000)

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'b answer' }],
    })
    await b.holder.start()
    await a.bus.wake(SESSION)
    const claimed = await flushUntil({ check: () => b.holder.heldIds().length === 1 })
    expect(claimed).toBe(true)

    const runtimeB = b.runtimes[0]
    if (runtimeB === undefined) throw new Error('no runtime for b')
    expect(Date.now()).toBeLessThan(notBeforeMs)
    expect(runtimeB.model.requests).toHaveLength(0)

    const called = await flushUntil({
      check: () => runtimeB.model.requests.length > 0,
      attempts: 5_000,
    })
    expect(called).toBe(true)
    expect(Date.now()).toBeGreaterThanOrEqual(notBeforeMs)
    expect(retryFacts(await fullEvents(a)).filter((event) => event.key === fact.key)).toHaveLength(
      1,
    )

    const answered = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(answered).toBe(true)
  }, 20_000)
})
