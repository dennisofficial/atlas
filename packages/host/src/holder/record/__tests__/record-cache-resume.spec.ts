import { describe, expect, it } from 'bun:test'
import {
  ECompactionAnchor,
  ERetryReason,
  chainHash,
  toCallId,
  type LogHead,
} from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'
import { RecordResumeCache } from '../record-resume'
import {
  AT,
  THREAD,
  answered,
  appendSpilled,
  appendTo,
  openThread,
  probeOf,
  said,
  transcriptOf,
} from './resume-fixtures'

const contentOf = (cache: RecordCache) => ({
  thread: cache.threadId(),
  chain: cache.eventsAfter(0).map((event) => [event.seq, event.type, chainHash(event)]),
  resolved: cache.eventsAfter(0).map((event) => cache.resolvedEvent(event)),
  committed: cache.eventsAfter(0).map((event) => cache.committedHashAtSeq(event.seq)),
  visible: cache.visibleEvents().map((event) => event.seq),
  loop: cache.visibleLoopEvents(),
  loopAfter: cache.loopEventsAfter(0),
  loopState: cache.loopState(),
  queued: cache.queuedSince(),
  lastUserSaid: cache.bookkeeping().lastUserSaidSeq(),
  dispatched: cache.bookkeeping().findDispatched(toCallId('call-1')),
  fact: cache.bookkeeping().fact('consult:1'),
  facts: cache.bookkeeping().factsWithPrefix('consult:'),
  spilled: cache.bookkeeping().fact('resource:1'),
  retry: cache.bookkeeping().retry('retry-1'),
  retries: cache.bookkeeping().retriesWithPrefix('retry-'),
  observation: cache.bookkeeping().lastObservation('repo-1'),
  workspace: cache.bookkeeping().workspace(),
  blobs: cache.resolvedBlobBytes(),
  retained: cache.retainedBytes(),
})

const viewOf = (cache: RecordCache) => ({ head: cache.currentHead(), ...contentOf(cache) })

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
    expect(resumed).not.toBe(first)
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
    stale.replaceHead({ seq: 1, hash: late.events[0]?.prevHash ?? head.hash })

    expect(resumed.eventsAfter(0).map((event) => event.seq)).toEqual([1, 2])
    expect(resumed.currentHead()).toEqual(head)
    expect(viewOf(resumed)).toEqual(viewOf(await RecordCache.load({ plane, threadId: THREAD })))
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

  it('resumes to the state a full load reaches, including a suffix committed after it', async () => {
    const { plane, epoch } = await openThread()
    const resume = new RecordResumeCache()
    await appendTo({
      plane,
      epoch,
      bodies: [
        said('build the parser'),
        { type: 'tool-dispatched', callId: toCallId('call-1'), name: 'bash' },
        { type: 'fact-recorded', key: 'consult:1', kind: 'consult', value: true },
        {
          type: 'retry-scheduled',
          key: 'retry-1',
          notBefore: AT,
          attempt: 1,
          reason: ERetryReason.Network,
        },
        {
          type: 'branches-observed',
          repo: 'repo-1',
          head: 'abc123',
          defaultBranch: 'main',
          base: 'main',
          branches: [{ name: 'main', sha: 'abc123' }],
          worktrees: [],
        },
        answered('parser built'),
      ],
    })
    await appendSpilled({
      plane,
      epoch,
      body: {
        type: 'fact-recorded',
        key: 'resource:1',
        kind: 'resource',
        value: { text: 'x'.repeat(512) },
      },
      thresholdBytes: 64,
    })

    for (let round = 0; round < 3; round += 1) {
      const resumed = await RecordCache.load({ plane, threadId: THREAD, resume })
      expect(viewOf(resumed)).toEqual(viewOf(await RecordCache.load({ plane, threadId: THREAD })))

      const appended = await appendTo({
        plane,
        epoch,
        bodies: [
          said(`round ${round}`),
          { type: 'workspace-prepared' },
          { type: 'fact-recorded', key: `consult:${round + 2}`, kind: 'consult', value: round },
          answered(`done ${round}`),
        ],
      })
      resumed.extend({ events: appended.events, head: appended.head })

      expect(viewOf(resumed)).toEqual(viewOf(await RecordCache.load({ plane, threadId: THREAD })))
    }
  })
})
