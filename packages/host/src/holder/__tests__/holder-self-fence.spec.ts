import { describe, expect, it } from 'bun:test'

import type { V2Event } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const longExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
    ],
  },
  { text: 'after fence' },
] as const

const fullLog = async (rig: HolderRig): Promise<V2Event[]> => {
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

const failRenews = (rig: HolderRig): (() => void) => {
  const plane = rig.plane
  const originalRenew = plane.renew.bind(plane)
  plane.renew = (params: { sessionId: string; holderId: string; epoch: number }) =>
    originalRenew({ ...params, epoch: params.epoch + 1000 })
  return () => {
    plane.renew = originalRenew
  }
}

const claimWithB = async (a: HolderRig): Promise<HolderRig> => {
  a.clock.advance(31_000)
  const b = await makeRig({
    holderId: 'holder-b',
    plane: a.plane,
    bus: a.bus,
    clock: a.clock,
    daemon: a.daemon,
    script: [{ text: 'collected' }],
  })
  await b.holder.start()
  await a.bus.wake(SESSION)
  return b
}

describe('SessionHolder self-fence (F7)', () => {
  it('detaches without cancelling the running exec; the next holder collects it as done', async () => {
    const a = await makeRig({ holderId: 'holder-a', script: longExecScript })
    await seedSession(a)
    await a.holder.start()
    await a.post('long exec')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    expect(a.runCount()).toBe(1)

    const restoreRenews = failRenews(a)
    a.clock.advance(5_000)
    const fenced = await flushUntil({ check: () => a.holder.heldIds().length === 0 })
    expect(fenced).toBe(true)
    restoreRenews()
    await new Promise((resolve) => setTimeout(resolve, 100))
    a.holder.discard()

    const b = await claimWithB(a)
    const claimed = await flushUntil({
      check: () => b.runtimes.length > 0,
      attempts: 100,
      clock: a.clock,
      advanceMs: 2_000,
    })
    expect(claimed).toBe(true)
    const settled = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-result'),
      attempts: 400,
    })
    expect(settled).toBe(true)

    const results = (await fullLog(a)).filter((event) => event.type === 'tool-result')
    expect(results.length).toBe(1)
    const result = results[0]
    if (result?.type !== 'tool-result') throw new Error('no tool-result')
    expect(result.error).toBeUndefined()
    expect(result.interrupted).not.toBe(true)
    expect(a.runCount()).toBe(1)
  }, 15_000)
})
