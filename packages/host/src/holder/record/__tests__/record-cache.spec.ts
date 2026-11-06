import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  ECompactionAnchor,
  chainEvents,
  toCallId,
  toRunId,
  toThreadId,
  type LogHead,
  type V2Body,
} from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-06T12:00:00.000Z'

const said = (text: string): V2Body => ({ type: 'user-said', text })
const answered = (text: string): V2Body => ({
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
  bodies: readonly V2Body[]
}): Promise<{ head: LogHead; events: ReturnType<typeof chainEvents> }> => {
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

const summaryOver = (throughSeq: number): V2Body => ({
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq,
  anchor: ECompactionAnchor.Prefix,
  summary: 'the opening work',
})

const textsOf = (cache: RecordCache): string[] =>
  cache.visibleLoopEvents().flatMap((event) => {
    if (event.type === 'user-said') return [event.text]
    if (event.type === 'assistant-said') return [JSON.stringify(event.parts)]
    if (event.type === 'history-compacted') return [`summary:${event.replaced}`]
    return []
  })

describe('RecordCache', () => {
  it('skips the bodies a summary hid but keeps the bookkeeping inside the range', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [
        said('build the parser'),
        { type: 'tool-dispatched', callId: toCallId('call-1'), name: 'bash' },
        answered('parser built'),
        { type: 'fact-recorded', key: 'consult:1', kind: 'consult', value: true },
        said('now the lexer'),
        answered('lexer built'),
        summaryOver(4),
      ],
    })

    const cache = await RecordCache.load({ plane, threadId: THREAD })

    expect(cache.eventsAfter(0).map((event) => event.type)).toEqual([
      'user-said',
      'tool-dispatched',
      'fact-recorded',
      'user-said',
      'assistant-said',
      'history-summarised',
    ])
    expect(cache.bookkeeping().findDispatched('call-1')).toEqual({ bootId: undefined })
    expect(textsOf(cache)).toEqual([
      'now the lexer',
      expect.stringContaining('lexer built'),
      'summary:4',
    ])
    expect(cache.currentHead().seq).toBe(7)
  })

  it('reloads the hidden bodies when a rewind undoes the summary', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [said('first'), answered('one'), said('second'), answered('two'), summaryOver(2)],
    })
    const cache = await RecordCache.load({ plane, threadId: THREAD })
    expect(textsOf(cache)).not.toContain('first')

    const rewound = await appendTo({
      plane,
      epoch,
      bodies: [{ type: 'history-rewound', toSeq: 4 }],
    })
    cache.extend({ events: rewound.events, head: rewound.head })
    await cache.refillIfRevealed()

    expect(textsOf(cache)).toEqual([
      'first',
      expect.stringContaining('one'),
      'second',
      expect.stringContaining('two'),
    ])
    expect(cache.currentHead()).toEqual(rewound.head)
  })

  it('loads only the uncovered tail and the bookkeeping of a summarised 20k-event thread', async () => {
    const { plane, epoch } = await openThread()
    const total = 20_000
    const covered = 19_000
    for (let seq = 0; seq < total; seq += 500) {
      const bodies = Array.from({ length: 500 }, (_, index): V2Body => {
        const at = seq + index
        if (at % 100 === 0) return { type: 'fact-recorded', key: `f:${at}`, kind: 'f', value: at }
        return at % 2 === 0 ? said(`ask ${at}`) : answered(`reply ${at}`)
      })
      await appendTo({ plane, epoch, bodies })
    }
    await appendTo({ plane, epoch, bodies: [summaryOver(covered)] })

    const cache = await RecordCache.load({ plane, threadId: THREAD })

    const types = cache.eventsAfter(0).map((event) => event.type)
    const coveredRows = cache.eventsAfter(0).filter((event) => event.seq <= covered)
    expect(coveredRows.every((event) => event.type !== 'assistant-said')).toBe(true)
    expect(types.filter((type) => type === 'fact-recorded').length).toBe(total / 100)
    expect(cache.eventsAfter(0).length).toBeLessThan(total * 0.6)
    expect(cache.visibleLoopEvents().length).toBe(total - covered - 10 + 1)
  }, 60_000)

  it('does not reload for a rewind that leaves every summary in place', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [said('first'), answered('one'), summaryOver(2), said('second'), answered('two')],
    })
    const cache = await RecordCache.load({ plane, threadId: THREAD })
    let reads = 0
    const readEvents = plane.readEvents.bind(plane)
    plane.readEvents = (params) => {
      reads += 1
      return readEvents(params)
    }

    const rewound = await appendTo({
      plane,
      epoch,
      bodies: [{ type: 'history-rewound', toSeq: 4 }],
    })
    cache.extend({ events: rewound.events, head: rewound.head })
    await cache.refillIfRevealed()

    expect(reads).toBe(0)
    expect(textsOf(cache)).toEqual(['summary:2', 'second'])
  })
})
