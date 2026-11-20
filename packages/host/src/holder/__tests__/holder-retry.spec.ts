import { describe, expect, it } from 'bun:test'

import type { V2Event } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'

import {
  flushUntil,
  makeRig,
  postAndRun,
  seedSession,
  SESSION,
  THREAD_ID,
  type HolderRig,
} from './holder-rig'

const scriptedModelOf = (rig: HolderRig): ScriptedModel => {
  const runtime = rig.runtimes[0]
  if (runtime === undefined) throw new Error('no runtime')
  return runtime.model as ScriptedModel
}

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
    (event): event is Extract<V2Event, { type: 'retry-scheduled' }> =>
      event.type === 'retry-scheduled',
  )

const notBeforeOf = (fact: Extract<V2Event, { type: 'retry-scheduled' }>): number =>
  Date.parse(fact.notBefore)

describe('holder retry deadlines', () => {
  it('a handoff mid-backoff waits out the deadline for the retry, then hands the turn back', async () => {
    const a = await makeRig({
      script: [{ throws: new Error('transient boom') }, { text: 'a answer' }],
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
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      sweepMs: 300,
      script: [{ text: 'b answer' }],
    })
    await b.holder.start()

    const draining = a.holder.drain()
    await a.flush()

    const modelA = scriptedModelOf(a)
    expect(modelA.requests).toHaveLength(1)
    while (a.clock.now() < notBeforeMs) {
      a.clock.advance(Math.min(100, notBeforeMs - a.clock.now()))
      await b.flush()
      if (a.clock.now() < notBeforeMs) expect(modelA.requests).toHaveLength(1)
    }
    const retried = await flushUntil({ check: () => modelA.requests.length > 1 })
    expect(retried).toBe(true)
    expect(a.clock.now()).toBeGreaterThanOrEqual(notBeforeMs)

    await draining

    expect((await a.events()).some((event) => event.type === 'run-failed')).toBe(false)
    expect(b.runtimes.flatMap((runtime) => (runtime.model as ScriptedModel).requests)).toHaveLength(
      0,
    )

    expect(retryFacts(await fullEvents(a)).filter((event) => event.key === fact.key)).toHaveLength(
      1,
    )
    const saids = (await fullEvents(a)).filter(
      (event): event is Extract<V2Event, { type: 'assistant-said' }> =>
        event.type === 'assistant-said',
    )
    expect(saids).toHaveLength(1)
    expect(saids[0]?.interrupted).toBeUndefined()
    expect(saids[0]?.aborted).toBeUndefined()
    const lease = await b.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderHostId).toBeNull()
  }, 20_000)
})
