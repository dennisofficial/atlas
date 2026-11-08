import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, ESessionStatus, sessionStatusOf, type V2Event } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, THREAD_ID, type HolderRig } from './holder-rig'

const STALL_MS = 200

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

const failuresOf = (events: readonly V2Event[]) =>
  events.flatMap((event) => (event.type === 'run-failed' ? [event.failure] : []))

const stuckUntilAborted = (signal: AbortSignal): Promise<never> =>
  new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason as unknown), { once: true })
  })

describe('SessionHolder progress watchdog', () => {
  it('records one stalled run-failed, fails the status and answers the next message', async () => {
    let steps = 0
    const rig = await makeRig({
      stallAfterMs: STALL_MS,
      model: () =>
        ({
          identity: { id: 'stuck', modelId: 'stuck-1' },
          step: ({ signal }: { signal: AbortSignal }) => {
            steps += 1
            if (steps === 1) return stuckUntilAborted(signal)
            return Promise.resolve({
              parts: [{ type: 'text', text: 'back again' }],
              toolCalls: [],
              finishReason: 'stop',
            })
          },
        }) as never,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    await rig.flush()
    expect(steps).toBe(1)

    const stalled = await flushUntil({
      check: async () => failuresOf(await fullLog(rig)).length > 0,
      clock: rig.clock,
      advanceMs: STALL_MS,
      attempts: 100,
    })
    expect(stalled).toBe(true)
    await rig.flush()
    rig.clock.advance(5 * STALL_MS)
    await rig.flush()

    const events = await fullLog(rig)
    const failures = failuresOf(events)
    expect(failures.length).toBe(1)
    expect(failures[0]?.kind).toBe(ERunFailureKind.Stalled)
    expect(failures[0]?.message).toContain('no progress for')
    expect(steps).toBe(1)
    expect(rig.runtimes.length).toBe(1)
    expect(rig.runtimes[0]?.stopped).toBe(false)

    const status = sessionStatusOf({
      events,
      live: true,
      unconsumedInbox: false,
      now: new Date(rig.clock.now()).toISOString(),
    })
    expect(status.state).toBe(ESessionStatus.Failed)
    expect(status.reason).toBe(failures[0]?.message)

    await rig.post('are you there')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      clock: rig.clock,
      advanceMs: 2_000,
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(failuresOf(await fullLog(rig)).length).toBe(1)
  })
})
