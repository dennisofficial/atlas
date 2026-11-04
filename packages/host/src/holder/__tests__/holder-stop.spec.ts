import { describe, expect, it } from 'bun:test'

import type { V2Event } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const fullLog = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> => {
  const events: V2Event[] = []
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
  it('a stop inbox entry mid-exec aborts the turn, cancels the daemon call and consumes the entry', async () => {
    const rig = await makeRig({
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
    rig.clock.advance(2_000)
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
        (await rig.events()).filter((event) => event.type === 'input-consumed').length >= 2,
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
    expect(log.filter((event) => event.type === 'input-consumed').length).toBe(2)
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
    expect(rig.runCount()).toBe(runsBeforeStop)
    const afterResult = log.filter((event) => event.seq > (result?.seq ?? 0))
    expect(afterResult.some((event) => event.type === 'assistant-said')).toBe(false)
  }, 15_000)
})

describe('SessionHolder idle', () => {
  it('after 30 idle minutes the runtime is released and the lease revoked; a new post reclaims', async () => {
    const rig = await makeRig({ holderId: 'holder-a', idleMinutes: 30 })
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
    expect(lease.lease.holderId).toBeNull()
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
