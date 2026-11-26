import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  ECompactionAnchor,
  chainEvents,
  chainHash,
  toCallId,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'
import { RecordResumeCache } from '../record-resume'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-06T12:00:00.000Z'

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })
const answered = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

const appendTo = async (args: {
  plane: ControlPlane
  epoch: number
  bodies: readonly RecordEventBody[]
}): Promise<{ head: LogHead; events: RecordEvent[] }> => {
  const from = await args.plane.head({ threadId: THREAD })
  const events = chainEvents({
    threadId: THREAD,
    runId: toRunId('run-1'),
    epoch: args.epoch,
    at: AT,
    bodies: args.bodies,
    from,
  })
  const outcome = await args.plane.append({ threadId: THREAD, epoch: args.epoch, events })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return { head: outcome.head, events }
}

type ReadPage = Awaited<ReturnType<ControlPlane['readEvents']>>
type ReadParams = Parameters<ControlPlane['readEvents']>[0]

type Probe = {
  plane: ControlPlane
  reads: number[]
  head: LogHead | undefined
  trap: ((page: ReadPage, index: number) => ReadPage) | undefined
}

const probeOf = (plane: ControlPlane): Probe => {
  const probe: Probe = { plane, reads: [], head: undefined, trap: undefined }
  probe.plane = new Proxy(plane, {
    get: (target, key, receiver) => {
      if (key === 'head' && probe.head !== undefined) return async () => probe.head
      if (key !== 'readEvents') return Reflect.get(target, key, receiver)
      return async (params: ReadParams) => {
        const index = probe.reads.push(params.afterSeq)
        const page = await target.readEvents(params)
        return probe.trap === undefined ? page : probe.trap(page, index)
      }
    },
  })
  return probe
}

const contentOf = (cache: RecordCache) => ({
  chain: cache.eventsAfter(0).map((event) => [event.seq, event.type, chainHash(event)]),
  visible: cache.visibleEvents().map((event) => event.seq),
  loop: cache.visibleLoopEvents(),
  loopState: cache.loopState(),
  queued: cache.queuedSince(),
  dispatched: cache.bookkeeping().findDispatched(toCallId('call-1')),
  fact: cache.bookkeeping().fact('consult:1'),
})

const viewOf = (cache: RecordCache) => ({ head: cache.currentHead(), ...contentOf(cache) })

const transcriptOf = (count: number): RecordEventBody[] =>
  Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? said(`ask ${index}`) : answered(`reply ${index}`),
  )

describe('RecordCache resume', () => {
  it('reads only the tail a host already holds', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, bodies: transcriptOf(1200) })
    const probe = probeOf(plane)
    const resume = new RecordResumeCache()
    const first = await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })
    const cachedHead = first.currentHead()

    await appendTo({ plane, epoch, bodies: [said('the next turn')] })
    probe.reads.length = 0
    const resumed = await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })

    expect(probe.reads[0]).toBe(cachedHead.seq)
    expect(probe.reads.every((afterSeq) => afterSeq >= cachedHead.seq)).toBe(true)
    expect(resumed).toBe(first)
    expect(contentOf(resumed)).toEqual(
      contentOf(await RecordCache.load({ plane, threadId: THREAD })),
    )
  })

  it('ignores a dead session that extends the record after it was resumed', async () => {
    const { plane, epoch } = await openThread()
    const resume = new RecordResumeCache()
    await appendTo({ plane, epoch, bodies: [said('first')] })
    const stale = await RecordCache.load({ plane, threadId: THREAD, resume })

    const late = await appendTo({ plane, epoch, bodies: [said('second')] })
    const resumed = await RecordCache.load({ plane, threadId: THREAD, resume })
    const head = resumed.currentHead()

    stale.extend({ events: late.events, head: late.head })

    expect(resumed.eventsAfter(0).map((event) => event.seq)).toEqual([1, 2])
    expect(resumed.currentHead()).toEqual(head)
  })

  it('refills from the start when the delta rewinds history', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [said('first'), answered('one'), said('second'), answered('two')],
    })
    const probe = probeOf(plane)
    const resume = new RecordResumeCache()
    await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })

    await appendTo({ plane, epoch, bodies: [{ type: 'history-rewound', toSeq: 2 }] })
    probe.reads.length = 0
    const resumed = await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })

    expect(probe.reads).toContain(0)
    expect(viewOf(resumed)).toEqual(viewOf(await RecordCache.load({ plane, threadId: THREAD })))
  })

  it('resumes a thread whose history is already summarised', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [
        said('first'),
        answered('one'),
        said('second'),
        answered('two'),
        {
          type: 'history-summarised',
          fromSeq: 1,
          throughSeq: 4,
          anchor: ECompactionAnchor.Prefix,
          summary: 'the opening work',
        },
      ],
    })
    const resume = new RecordResumeCache()
    const cached = await RecordCache.load({ plane, threadId: THREAD, resume })
    expect(cached.visibleEvents().length).toBeLessThan(5)

    await appendTo({
      plane,
      epoch,
      bodies: [said('after the summary'), answered('still here')],
    })
    const resumed = await RecordCache.load({ plane, threadId: THREAD, resume })

    expect(resumed).toBe(cached)
    expect(viewOf(resumed)).toEqual(viewOf(await RecordCache.load({ plane, threadId: THREAD })))
  })

  it('refills from the start when the head hash no longer matches', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [said('a one'), answered('a two'), said('a three')],
    })
    const probe = probeOf(plane)
    const resume = new RecordResumeCache()
    const cached = await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })

    probe.reads.length = 0
    probe.head = { seq: cached.currentHead().seq, hash: 'f'.repeat(64) as LogHead['hash'] }
    const resumed = await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })

    expect(probe.reads[0]).toBe(0)
    expect(contentOf(resumed)).toEqual(
      contentOf(await RecordCache.load({ plane, threadId: THREAD })),
    )
  })

  it('refills when the appended events do not continue the cached chain', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [said('b one'), answered('b two'), said('b three')],
    })
    const probe = probeOf(plane)
    const resume = new RecordResumeCache()
    await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })
    await appendTo({
      plane,
      epoch,
      bodies: [said('b four'), answered('b five'), said('b six')],
    })

    probe.reads.length = 0
    probe.trap = (page, index) => {
      const first = page.events[0]
      if (index > 1 || first === undefined) return page
      return { ...page, events: [{ ...first, prevHash: 'x'.repeat(64) as LogHead['hash'] }] }
    }
    const resumed = await RecordCache.load({ plane: probe.plane, threadId: THREAD, resume })

    expect(probe.reads).toContain(0)
    expect(contentOf(resumed)).toEqual(
      contentOf(await RecordCache.load({ plane, threadId: THREAD })),
    )
  })

  it('resumes to the state a full load reaches', async () => {
    const { plane, epoch } = await openThread()
    const resume = new RecordResumeCache()
    await appendTo({
      plane,
      epoch,
      bodies: [
        said('build the parser'),
        { type: 'tool-dispatched', callId: toCallId('call-1'), name: 'bash' },
        { type: 'fact-recorded', key: 'consult:1', kind: 'consult', value: true },
        answered('parser built'),
      ],
    })

    for (let round = 0; round < 3; round += 1) {
      const resumed = await RecordCache.load({ plane, threadId: THREAD, resume })
      const fresh = await RecordCache.load({ plane, threadId: THREAD })
      expect(viewOf(resumed)).toEqual(viewOf(fresh))
      expect(resumed.loopEventsAfter(0)).toEqual(fresh.loopEventsAfter(0))

      await appendTo({
        plane,
        epoch,
        bodies: [
          said(`round ${round}`),
          { type: 'workspace-prepared' },
          { type: 'fact-recorded', key: `consult:${round + 2}`, kind: 'consult', value: round },
          answered(`done ${round}`),
        ],
      })
    }
  })
})
