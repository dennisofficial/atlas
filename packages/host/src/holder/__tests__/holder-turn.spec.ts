import { describe, expect, it } from 'bun:test'

import { chainHash, type V2Event } from '@dltech/atlas-core'
import { toThreadId } from '@dltech/atlas-core'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, THREAD_ID } from './holder-rig'

const fullLog = async (rig: Awaited<ReturnType<typeof makeRig>>) => {
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

describe('SessionHolder turn', () => {
  it('post -> claim -> input-consumed + user-said in one append, then assistant-said', async () => {
    const rig = await makeRig({ script: [{ text: 'hello back' }] })
    await seedSession(rig)
    await rig.holder.start()

    const posted = await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((e) => e.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    const log = await fullLog(rig)
    const types = log.map((event) => event.type)
    expect(types.slice(0, 2)).toEqual(['input-consumed', 'user-said'])
    const consumed = log[0]
    if (consumed?.type !== 'input-consumed') throw new Error('expected input-consumed')
    expect(consumed.inboxId).toBe(posted.inboxId)
    const said = log[1]
    if (said?.type !== 'user-said') throw new Error('expected user-said')
    expect(said.requestId).toBe(`inbox:${posted.inboxId}`)
    expect(types).toContain('assistant-said')

    expect(rig.bus.statuses(SESSION)).toContain('starting')
    expect(rig.bus.statuses(SESSION)).toContain('thinking')
    expect(rig.bus.statuses(SESSION)).toContain('idle')
  })

  it('a daemon tool call dispatches with bootId, records a result, and acks the scope', async () => {
    const rig = await makeRig({
      script: [
        { calls: [{ callId: 'call-1', name: 'bash', input: { command: 'echo one' } }] },
        { text: 'done' },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()

    await postAndRun(rig, 'run it')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((e) => e.type === 'tool-result'),
    })
    expect(saw).toBe(true)

    const log = await fullLog(rig)
    const dispatched = log.find((event) => event.type === 'tool-dispatched')
    expect(dispatched).toBeDefined()
    if (dispatched?.type === 'tool-dispatched') {
      expect(dispatched.bootId).toBe(rig.daemon.bootId())
    }
    const result = log.find((event) => event.type === 'tool-result')
    expect(result).toBeDefined()
    if (result?.type === 'tool-result') {
      expect(result.error).toBeUndefined()
    }
    expect(rig.daemon.runCount()).toBe(1)
    const acked = rig.runtimes.flatMap((runtime) => runtime.ackedScopes)
    expect(acked.some((key) => key.endsWith(':call-1'))).toBe(true)
  })

  it('every event is appended individually and the chain verifies', async () => {
    const rig = await makeRig({
      script: [
        { calls: [{ callId: 'call-1', name: 'bash', input: { command: 'echo one' } }] },
        { text: 'done' },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'go')
    const saw = await flushUntil({
      check: async () => {
        const log = await rig.events()
        return (
          log.some((e) => e.type === 'assistant-said') && log.some((e) => e.type === 'tool-result')
        )
      },
    })
    expect(saw).toBe(true)

    const log = await fullLog(rig)
    expect(log.length).toBeGreaterThanOrEqual(5)
    for (let index = 0; index < log.length; index += 1) {
      const event = log[index] as V2Event
      expect(event.seq).toBe(index + 1)
      const recomputed = chainHash(event)
      const next = log[index + 1] as V2Event | undefined
      if (next !== undefined) expect(next.prevHash).toBe(recomputed)
    }
    const head = await rig.plane.head({ threadId: toThreadId('thread-rig') })
    expect(head.seq).toBe(log.length)
  })
})
