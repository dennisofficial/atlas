import { describe, expect, it } from 'bun:test'

import type { RecordEvent } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const fullLog = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
  let afterSeq = 0
  for (;;) {
    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

describe('SessionHolder stop', () => {
  it('a stop inbox entry mid-exec aborts the turn, cancels the daemon call and consumes the stop', async () => {
    const rig = await makeRig({
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
        { text: 'never reached' },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('long exec')
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    const runsBeforeStop = rig.runCount()

    await rig.postStop()
    await rig.wake()
    await rig.flush()

    const settled = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(settled).toBe(true)
    const consumed = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'input-consumed').length >= 1,
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(consumed).toBe(true)

    const log = await fullLog(rig)
    const result = log.find((event) => event.type === 'tool-result')
    expect(result).toBeDefined()
    if (result?.type === 'tool-result') {
      expect(result.error?.message ?? '').toContain('cancelled')
    }
    expect(log.filter((event) => event.type === 'input-consumed').length).toBe(1)
    expect(log.filter((event) => event.type === 'input-posted').length).toBe(1)
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
    expect(rig.runCount()).toBe(runsBeforeStop)
    const afterResult = log.filter((event) => event.seq > (result?.seq ?? 0))
    expect(afterResult.some((event) => event.type === 'assistant-said')).toBe(false)
  }, 15_000)

  it('a stop behind a full page of messages still aborts the running turn on one wake', async () => {
    const rig = await makeRig({
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
        { text: 'answered the queue' },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('long exec')
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    for (let i = 0; i < 100; i += 1) await rig.post(`queued ${i}`)
    await rig.postStop()
    await rig.wake()

    const aborted = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(aborted).toBe(true)

    const queuedAnswered = await flushUntil({
      check: async () => {
        const events = await fullLog(rig)
        return (
          events.filter((event) => event.type === 'user-said' && event.text.startsWith('queued '))
            .length === 100 && events.some((event) => event.type === 'assistant-said')
        )
      },
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(queuedAnswered).toBe(true)

    const log = await fullLog(rig)
    const result = log.find((event) => event.type === 'tool-result')
    if (result?.type === 'tool-result') {
      expect(result.error?.message ?? '').toContain('cancelled')
    }
    expect(log.filter((event) => event.type === 'user-said')).toHaveLength(101)
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 500 })).toEqual([])
  }, 15_000)

  it('a stop aborts the running turn only; the messages posted behind it still run exactly once', async () => {
    const rig = await makeRig({
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
        { text: 'answered both' },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('first')
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    const runsBeforeStop = rig.runCount()

    await rig.post('second')
    await rig.post('third')
    await rig.postStop()
    await rig.wake()

    const settled = await flushUntil({
      check: async () => {
        const events = await fullLog(rig)
        return (
          events.filter((event) => event.type === 'user-said').length === 3 &&
          events.some((event) => event.type === 'assistant-said')
        )
      },
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(settled).toBe(true)

    const log = await fullLog(rig)
    const result = log.find((event) => event.type === 'tool-result')
    if (result?.type === 'tool-result') {
      expect(result.error?.message ?? '').toContain('cancelled')
    }
    expect(log.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(log.filter((event) => event.type === 'assistant-said')).toHaveLength(1)
    expect(log.filter((event) => event.type === 'tool-result')).toHaveLength(1)
    expect(rig.runCount()).toBe(runsBeforeStop)
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
  }, 15_000)

  it('a stopped turn consumes the stop before a gated branch refresh opens', async () => {
    let reads = 0
    let openGate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      openGate = () => resolve()
    })
    const rig = await makeRig({
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
      watchedRepos: () => {
        reads += 1
        return reads === 1 ? Promise.resolve([]) : gate.then(() => ['/w'])
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('long exec')
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    await rig.postStop()
    await rig.wake()

    const consumed = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'input-consumed').length >= 1,
      attempts: 100,
    })
    expect(consumed).toBe(true)
    openGate?.()
  }, 15_000)
})

describe('SessionHolder idle', () => {
  it('after 30 idle minutes the runtime is released and the lease revoked; a new post reclaims', async () => {
    const rig = await makeRig({})
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)
    const runtime = rig.runtimes[0]
    if (runtime === undefined) throw new Error('no runtime')

    for (let step = 0; step < 30 * 6 + 6; step += 1) {
      rig.clock.advance(10_000)
      await rig.flush()
    }
    const released = await flushUntil({ check: () => runtime.released })
    expect(released).toBe(true)
    const lease = await rig.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderHostId).toBeNull()
    expect(lease.lease.wantsHolder).toBe(false)

    rig.script.current = [{ text: 'again' }]
    await rig.post('wake me')
    await rig.bus.wake(SESSION)
    const reclaimed = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'assistant-said').length >= 2,
      attempts: 200,
    })
    expect(reclaimed).toBe(true)
    expect(rig.runtimes.length).toBe(2)
  }, 15_000)
})
