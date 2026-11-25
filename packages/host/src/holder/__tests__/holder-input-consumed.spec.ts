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

describe('SessionHolder input events', () => {
  it('posts and says a message and refuses a malformed entry', async () => {
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

    const log = await fullLog(rig)
    const said = log.filter((event) => event.type === 'user-said')
    expect(said).toHaveLength(1)
    expect(said[0]).toMatchObject({ text: 'hello' })
    const consumed = log.filter((event) => event.type === 'input-consumed')
    expect(consumed).toHaveLength(1)
    expect(consumed[0]).toMatchObject({ consumed: 'discarded' })
    expect(consumed[0]).not.toMatchObject({ inboxId: (said[0] as { inboxId?: number }).inboxId })
  })

  it('never consumes a posted message when a stop entry arrives', async () => {
    const rig = await makeRig({ script: [{ text: 'done' }] })
    await seedSession(rig)
    await rig.holder.start()
    const posted = await rig.post('hello')
    await rig.wake()
    const settled = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(settled).toBe(true)

    await rig.postStop()
    await rig.wake()
    await rig.flush()
    await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'input-consumed'),
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    const log = await fullLog(rig)
    const consumedIds = log.flatMap((event) =>
      event.type === 'input-consumed' ? [event.inboxId] : [],
    )
    expect(log.filter((event) => event.type === 'user-said')).toHaveLength(1)
    expect(consumedIds).not.toContain(posted.inboxId)
  }, 15_000)
})
