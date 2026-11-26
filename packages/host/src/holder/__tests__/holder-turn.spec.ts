import { describe, expect, it } from 'bun:test'

import { chainHash, type RecordEvent } from '@dltech/atlas-core'
import { toThreadId } from '@dltech/atlas-core'

import { flushUntil, makeRig, postAndRun, seedSession, THREAD_ID } from './holder-rig'

const fullLog = async (rig: Awaited<ReturnType<typeof makeRig>>) => {
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

describe('SessionHolder turn', () => {
  it('post -> drain -> input-posted + user-said in one append, then the turn boundaries around the reply', async () => {
    const rig = await makeRig({ script: [{ text: 'hello back' }] })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    const prepared = await flushUntil({
      check: async () => (await rig.events()).some((e) => e.type === 'workspace-prepared'),
    })
    expect(prepared).toBe(true)

    const appends: { type: string }[][] = []
    const originalAppend = rig.plane.append.bind(rig.plane)
    rig.plane.append = (async (params: Parameters<typeof rig.plane.append>[0]) => {
      appends.push(params.events.map((event) => ({ type: (event as { type: string }).type })))
      return originalAppend(params)
    }) as typeof rig.plane.append

    const posted = await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((e) => e.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    expect(appends.map((append) => append.map((event) => event.type))).toEqual([
      ['turn-started'],
      ['input-posted', 'user-said'],
      ['assistant-said'],
      ['turn-ended'],
    ])

    const log = (await fullLog(rig)).filter(
      (event) => event.type !== 'workspace-prepared' && event.type !== 'workspace-attempt-started',
    )
    const types = log.map((event) => event.type)
    expect(types.slice(0, 4)).toEqual([
      'turn-started',
      'input-posted',
      'user-said',
      'assistant-said',
    ])
    expect(types).toContain('turn-ended')
    const postedEvent = log[1]
    if (postedEvent?.type !== 'input-posted') throw new Error('expected input-posted')
    expect(postedEvent.inboxId).toBe(posted.inboxId)
    const said = log[2]
    if (said?.type !== 'user-said') throw new Error('expected user-said')
    expect(said.requestId).toBe(`inbox:${posted.inboxId}`)
    expect(types).toContain('assistant-said')
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
    expect(acked.includes('call-1')).toBe(true)
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
      const event = log[index] as RecordEvent
      expect(event.seq).toBe(index + 1)
      const recomputed = chainHash(event)
      const next = log[index + 1] as RecordEvent | undefined
      if (next !== undefined) expect(next.prevHash).toBe(recomputed)
    }
    const head = await rig.plane.head({ threadId: toThreadId('thread-rig') })
    expect(head.seq).toBe(log.length)
  })
})
