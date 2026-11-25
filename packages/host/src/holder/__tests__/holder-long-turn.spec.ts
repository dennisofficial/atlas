import { describe, expect, it } from 'bun:test'

import type { RecordEvent } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, THREAD_ID, type HolderRig } from './holder-rig'

const HOUR_MS = 60 * 60_000

const fullLog = async (rig: HolderRig): Promise<RecordEvent[]> => {
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

describe('SessionHolder long turns', () => {
  it('lets a turn run for hours without cutting it short', async () => {
    let finishStep: (() => void) | undefined
    const rig = await makeRig({
      model: () =>
        ({
          identity: { id: 'slow', modelId: 'slow-1' },
          step: () =>
            new Promise((resolve) => {
              finishStep = () =>
                resolve({
                  parts: [{ type: 'text', text: 'done after hours' }],
                  toolCalls: [],
                  finishReason: 'stop',
                })
            }),
        }) as never,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('take your time')
    await rig.wake()
    await rig.flush()

    for (let hour = 0; hour < 5; hour += 1) {
      rig.clock.advance(HOUR_MS)
      await rig.flush()
    }
    const events = await fullLog(rig)
    expect(events.some((event) => event.type === 'run-failed')).toBe(false)
    expect(events.some((event) => event.type === 'assistant-said')).toBe(false)

    finishStep?.()
    const answered = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    const settled = await fullLog(rig)
    expect(settled.some((event) => event.type === 'run-failed')).toBe(false)
    const said = settled.find((event) => event.type === 'assistant-said')
    expect(said !== undefined && 'interrupted' in said && said.interrupted === true).toBe(false)
  })
})
