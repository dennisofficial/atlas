import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import {
  FakeClock,
  flushUntil,
  makeRig,
  postAndRun,
  seedSession,
  SESSION,
  THREAD_ID,
} from './holder-rig'

const consumedStopIds = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<number[]> => {
  const ids: number[] = []
  let afterSeq = 0
  for (;;) {
    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    for (const event of page.events) {
      if (event.type === 'input-consumed') ids.push(event.inboxId)
    }
    if (page.next === undefined) return ids
    afterSeq = page.next
  }
}

const makeClockedRig = async (args: {
  script?: Parameters<typeof makeRig>[0]['script']
}): Promise<{
  rig: Awaited<ReturnType<typeof makeRig>>
  plane: ControlPlane
  clock: FakeClock
}> => {
  const clock = new FakeClock()
  const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
  const plane = new ControlPlane({ store })
  const rig = await makeRig({ clock, plane, store, script: args.script })
  return { rig, plane, clock }
}

describe('SessionHolder inbox read failures', () => {
  it('a rejected pending-input read retries instead of falling into the idle wait', async () => {
    const { rig, plane, clock } = await makeClockedRig({})
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    let failures = 0
    const readInbox = plane.readInbox.bind(plane)
    plane.readInbox = async (params) => {
      if (failures < 2 && params.limit === 100) {
        failures += 1
        throw new Error('inbox read blew up')
      }
      return readInbox(params)
    }
    await rig.post('follow up')
    await rig.bus.wake(SESSION)

    const answered = await flushUntil({
      check: async () =>
        (await rig.events()).filter((event) => event.type === 'user-said').length === 2,
      attempts: 100,
      clock,
      advanceMs: 500,
    })
    expect(failures).toBe(2)
    expect(answered).toBe(true)
    expect(clock.now()).toBeLessThan(5_000)
  }, 15_000)

  it('a rejected stop read mid-turn retries and the stop still lands', async () => {
    const { rig, plane, clock } = await makeClockedRig({
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

    let failed = false
    const readInbox = plane.readInbox.bind(plane)
    plane.readInbox = async (params) => {
      if (!failed && params.limit === 100) {
        failed = true
        throw new Error('stop read blew up')
      }
      return readInbox(params)
    }
    const stop = await rig.postStop()
    await rig.wake()

    const settled = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
      clock,
      advanceMs: 500,
    })
    expect(failed).toBe(true)
    expect(settled).toBe(true)

    const log = await rig.events()
    const result = log.find((event) => event.type === 'tool-result')
    expect(result).toBeDefined()
    const consumed = await flushUntil({
      check: async () => (await consumedStopIds(rig)).includes(stop.inboxId),
      attempts: 200,
      clock,
      advanceMs: 500,
    })
    expect(consumed).toBe(true)
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
  }, 15_000)
})
