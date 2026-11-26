import { describe, expect, it } from 'bun:test'
import { ECompactionAnchor, type RecordEventBody } from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'
import { resyncHead } from '../record-commit'
import { RecordResumeCache } from '../record-resume'
import { THREAD, answered, appendTo, openThread, said } from './resume-fixtures'

const viewOf = (cache: RecordCache) => ({
  head: cache.currentHead(),
  chain: cache.eventsAfter(0).map((event) => [event.seq, event.type]),
  visible: cache.visibleEvents().map((event) => event.seq),
  loop: cache.visibleLoopEvents(),
  loopState: cache.loopState(),
})

const summarised = (args: { fromSeq: number; throughSeq: number }): RecordEventBody => ({
  type: 'history-summarised',
  fromSeq: args.fromSeq,
  throughSeq: args.throughSeq,
  anchor: ECompactionAnchor.Prefix,
  summary: 'the opening work',
})

describe('RecordCache hand-off', () => {
  it('keeps a resync that lands after the hand-off out of the resumed record', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [said('one'), answered('two'), said('three')],
    })
    const resume = new RecordResumeCache()
    const stale = await RecordCache.load({ plane, threadId: THREAD, resume })
    const staleHead = stale.currentHead()

    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let heads = 0
    const delayed = new Proxy(plane, {
      get: (target, key, receiver) => {
        if (key !== 'head') return Reflect.get(target, key, receiver)
        return async (params: { threadId: string }) => {
          const head = await target.head(params)
          heads += 1
          if (heads > 1) return head
          await held
          return staleHead
        }
      },
    })
    const resync = resyncHead({ plane: delayed, threadId: THREAD }, stale)

    const late = await appendTo({ plane, epoch, bodies: [said('four')] })
    const resumed = await RecordCache.load({ plane, threadId: THREAD, resume })
    const advanced = resumed.currentHead()

    release()
    await resync

    expect(late.events.map((event) => event.seq)).toEqual([4])
    expect(resumed.currentHead()).toEqual(advanced)
    expect(resumed.eventsAfter(0).map((event) => event.seq)).toEqual([1, 2, 3, 4])
    const next = await appendTo({ plane, epoch, bodies: [answered('five')] })
    expect(next.events.map((event) => event.seq)).toEqual([5])
  })

  it('fills from the start when the holder summarised history itself', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [said('one'), answered('two'), said('three'), answered('four')],
    })
    const resume = new RecordResumeCache()
    const first = await RecordCache.load({ plane, threadId: THREAD, resume })
    const summary = await appendTo({
      plane,
      epoch,
      bodies: [summarised({ fromSeq: 1, throughSeq: 4 })],
    })
    first.extend({ events: summary.events, head: summary.head })

    const resumed = await RecordCache.load({ plane, threadId: THREAD, resume })

    expect(resumed).not.toBe(first)
    expect(viewOf(resumed)).toEqual(viewOf(await RecordCache.load({ plane, threadId: THREAD })))
  })

  it('fills from the start when the holder rewound history that a summary hid', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [
        said('one'),
        answered('two'),
        said('three'),
        answered('four'),
        summarised({ fromSeq: 1, throughSeq: 4 }),
      ],
    })
    const resume = new RecordResumeCache()
    const first = await RecordCache.load({ plane, threadId: THREAD, resume })
    const rewind = await appendTo({ plane, epoch, bodies: [{ type: 'history-rewound', toSeq: 2 }] })
    first.extend({ events: rewind.events, head: rewind.head })

    const resumed = await RecordCache.load({ plane, threadId: THREAD, resume })

    expect(resumed).not.toBe(first)
    expect(viewOf(resumed)).toEqual(viewOf(await RecordCache.load({ plane, threadId: THREAD })))
  })
})
