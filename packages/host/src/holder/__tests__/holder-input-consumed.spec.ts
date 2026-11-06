import { describe, expect, it } from 'bun:test'

import { EInputConsumed, type V2Event } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const consumedKinds = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
): Promise<(EInputConsumed | undefined)[]> => {
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
    if (page.next === undefined) break
    afterSeq = page.next
  }
  return events.flatMap((event) => (event.type === 'input-consumed' ? [event.consumed] : []))
}

describe('SessionHolder input-consumed kind', () => {
  it('writes Message for a consumed message and Discarded for a malformed entry', async () => {
    const rig = await makeRig({ script: [{ text: 'hello back' }] })
    await seedSession(rig)
    await rig.holder.start()
    await rig.plane.post({ sessionId: SESSION, kind: 'bogus', payload: '{}' })
    await rig.post('hello')
    await rig.wake()
    const settled = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(settled).toBe(true)

    const kinds = await consumedKinds(rig)
    expect(kinds).toContain(EInputConsumed.Discarded)
    expect(kinds).toContain(EInputConsumed.Message)
    expect(kinds).not.toContain(undefined)
  })

  it('writes Stop for a stop entry', async () => {
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

    await rig.postStop()
    await rig.wake()
    await rig.flush()
    const consumed = await flushUntil({
      check: async () => (await consumedKinds(rig)).length >= 2,
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(consumed).toBe(true)
    expect(await consumedKinds(rig)).toEqual([EInputConsumed.Message, EInputConsumed.Stop])
  }, 15_000)
})
