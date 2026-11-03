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
  // FIXME: hangs with the fake clock since the turn-time inbox poll was added; the stop path
  // (pollStops -> onStop -> turnAbort) needs a real-timer variant or a deterministic poll hook.
  it.skip('a stop inbox entry mid-exec aborts the turn and the result says cancelled', async () => {
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

    await rig.postStop()
    await rig.bus.wake(SESSION)

    const settled = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(settled).toBe(true)
    const result = (await fullLog(rig)).find((event) => event.type === 'tool-result')
    expect(result).toBeDefined()
    if (result?.type === 'tool-result') {
      expect(result.interrupted === true || result.error !== undefined).toBe(true)
    }
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

    rig.clock.advance(31 * 60_000)
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
    })
    expect(reclaimed).toBe(true)
    expect(rig.runtimes.length).toBe(2)
  }, 15_000)
})
