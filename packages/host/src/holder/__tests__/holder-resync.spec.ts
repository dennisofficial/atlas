import { describe, expect, it } from 'bun:test'

import { chainEvents, toRunId } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'
import { RecordCache } from '../record/record-cache'
import { resyncHead } from '../record/record-commit'

const otherWriterCommits = async (
  rig: HolderRig,
  args: { count: number; epoch: number },
): Promise<void> => {
  let head = await rig.plane.head({ threadId: THREAD_ID })
  const chunk = 100
  for (let done = 0; done < args.count; done += chunk) {
    const bodies = Array.from({ length: Math.min(chunk, args.count - done) }, () => ({
      type: 'user-said' as const,
      text: 'other writer',
      requestId: `other:${done}`,
    }))
    const events = chainEvents({
      threadId: THREAD_ID,
      runId: toRunId(`other-${done}`),
      epoch: args.epoch,
      bodies,
      from: head,
      at: new Date(rig.clock.now()).toISOString(),
    })
    const outcome = await rig.plane.append({ threadId: THREAD_ID, epoch: args.epoch, events })
    if (!outcome.ok) throw new Error(`other writer refused: ${JSON.stringify(outcome.refusal)}`)
    head = outcome.head
  }
}

describe('SessionHolder F8 resync', () => {
  it('a seq-mismatch beyond one page reloads every page before the head moves', async () => {
    const rig = await makeRig({ script: [{ text: 'recovered' }] })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    const cache = await RecordCache.load({ plane: rig.plane, threadId: THREAD_ID })
    expect(cache.currentHead().seq).toBe(4)

    await otherWriterCommits(rig, { count: 1_500, epoch: 1 })
    const storeHead = await rig.plane.head({ threadId: THREAD_ID })
    expect(storeHead.seq).toBeGreaterThan(1_500)

    const readCalls: number[] = []
    const originalRead = rig.plane.readEvents.bind(rig.plane)
    const countingPlane = {
      head: (params: { threadId: string }) => rig.plane.head(params),
      readEvents: async (params: Parameters<typeof rig.plane.readEvents>[0]) => {
        readCalls.push(params.afterSeq)
        return originalRead(params)
      },
    }
    await resyncHead({ plane: countingPlane, threadId: THREAD_ID }, cache)

    expect(readCalls.length).toBeGreaterThan(1)
    expect(readCalls[0]).toBe(4)
    expect(cache.currentHead().seq).toBe(storeHead.seq)
    expect(cache.all().length).toBe(storeHead.seq)
  }, 30_000)

  it('recovery ignores a call hidden by a history-rewound', async () => {
    const rig = await makeRig({ script: [{ text: 'fresh' }] })
    await seedSession(rig)
    const seededLease = await rig.plane.grant({ sessionId: SESSION, hostId: 9001 })

    const dispatched = chainEvents({
      threadId: THREAD_ID,
      runId: toRunId('run-stale'),
      epoch: seededLease.epoch,
      bodies: [
        {
          type: 'tool-dispatched',
          callId: 'call-stale' as never,
          name: 'bash',
        },
      ],
      at: new Date(rig.clock.now()).toISOString(),
    })
    const seeded = await rig.plane.append({
      threadId: THREAD_ID,
      epoch: seededLease.epoch,
      events: dispatched,
    })
    expect(seeded.ok).toBe(true)

    const rewound = chainEvents({
      threadId: THREAD_ID,
      runId: toRunId('run-rewind'),
      epoch: seededLease.epoch,
      bodies: [{ type: 'history-rewound', toSeq: 0 }],
      from: await rig.plane.head({ threadId: THREAD_ID }),
      at: new Date(rig.clock.now()).toISOString(),
    })
    const hidden = await rig.plane.append({
      threadId: THREAD_ID,
      epoch: seededLease.epoch,
      events: rewound,
    })
    expect(hidden.ok).toBe(true)
    await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })

    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    const log = await rig.events()
    expect(log.some((event) => event.type === 'tool-result')).toBe(false)
    expect(rig.daemon.runCount()).toBe(0)
    expect(log.filter((event) => event.type === 'user-said').length).toBe(1)
  }, 15_000)
})
