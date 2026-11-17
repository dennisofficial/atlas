import { describe, expect, it } from 'bun:test'

import { EInputConsumed, type V2Event } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, THREAD_ID } from './holder-rig'

const eventsOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return [...page.events]
}

const stopConsumed = (events: readonly V2Event[]): boolean =>
  events.some((event) => event.type === 'input-consumed' && event.consumed === EInputConsumed.Stop)

describe('SessionHolder after a consumed stop', () => {
  it('starts no new turn and asks for no resume nudge', async () => {
    const rig = await makeRig({
      script: [{ text: 'It was the best of times, it was the worst of times', streamMs: 2_000 }],
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('write me an essay')
    await rig.wake()
    await flushUntil({ check: async () => rig.runCount() > 0 })

    await rig.postStop()
    await rig.wake()
    const consumed = await flushUntil({
      check: async () => stopConsumed(await eventsOf(rig)),
      attempts: 200,
    })
    expect(consumed).toBe(true)
    const runs = rig.runCount()

    await rig.wake()
    await rig.flush()

    const events = await eventsOf(rig)
    expect(events.map((event) => event.type)).not.toContain('nudge')
    expect(rig.runCount()).toBe(runs)
  }, 15_000)
})
