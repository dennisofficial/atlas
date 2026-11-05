import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const handoffScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
    ],
  },
  { text: 'collected' },
] as const

const fullEvents = async (rig: HolderRig): Promise<{ type: string; inboxId?: number }[]> => {
  const out: { type: string; inboxId?: number }[] = []
  let afterSeq = 0
  for (;;) {
    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    for (const event of page.events) {
      out.push({
        type: event.type,
        ...(event.type === 'input-consumed' ? { inboxId: event.inboxId } : {}),
      })
    }
    if (page.next === undefined) return out
    afterSeq = page.next
  }
}

describe('SessionHolder startup stop', () => {
  it('a stop posted while the record of a resumable turn is loading still lands, with no timer advance', async () => {
    const a = await makeRig({ script: handoffScript })
    await seedSession(a)
    await a.holder.start()
    await a.post('run the long thing')
    await a.wake()
    const dispatched = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    const drain = a.holder.drain({ deadline: a.clock.now() + 1_000 })
    a.clock.advance(1_100)
    await drain
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'collected' }],
    })
    await b.holder.start()

    const readEvents = a.plane.readEvents.bind(a.plane)
    let releaseRecord: (() => void) | undefined
    const recordGate = new Promise<void>((resolve) => {
      releaseRecord = resolve
    })
    a.plane.readEvents = async (params) => {
      await recordGate
      return readEvents(params)
    }

    await a.bus.wake(SESSION)
    const claimed = await flushUntil({ check: () => b.holder.heldIds().length === 1 })
    expect(claimed).toBe(true)

    const stop = await a.plane.post({ sessionId: SESSION, kind: 'stop', payload: '{}' })
    await a.bus.wake(SESSION)
    const beforeRelease = a.clock.now()
    if (releaseRecord === undefined) throw new Error('gate never armed')
    releaseRecord()
    a.plane.readEvents = readEvents

    const consumed = await flushUntil({
      check: async () =>
        (await fullEvents(a)).some(
          (event) => event.type === 'input-consumed' && event.inboxId === stop.inboxId,
        ),
      attempts: 200,
    })
    expect(consumed).toBe(true)

    const events = await fullEvents(a)
    expect(events.some((event) => event.type === 'assistant-said')).toBe(false)
    expect(await a.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
    expect(a.clock.now()).toBe(beforeRelease)
  }, 15_000)
})
