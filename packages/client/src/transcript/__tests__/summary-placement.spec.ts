import { ECompactionAnchor } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { summariesAtTarget } from '../summary-placement'
import { log } from './fixture'

const compacted = (args: { fromSeq: number; throughSeq: number; summary: string }) => ({
  type: 'history-compacted' as const,
  anchor: ECompactionAnchor.Prefix,
  fromSeq: args.fromSeq,
  throughSeq: args.throughSeq,
  summary: args.summary,
  replaced: args.throughSeq - args.fromSeq + 1,
})

const shape = (events: readonly { type: string; seq: number }[]): [string, number][] =>
  events.map((event) => [event.type, event.seq])

describe('placing a summary where its range ends', () => {
  it('moves a summary at the tail before the first event past its range', () => {
    const events = log([
      { type: 'user-said', text: 'first' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'one' }] },
      { type: 'user-said', text: 'third' },
      compacted({ fromSeq: 1, throughSeq: 2, summary: 'two rows' }),
    ])

    expect(shape(summariesAtTarget(events))).toEqual([
      ['user-said', 1],
      ['assistant-said', 2],
      ['history-compacted', 4],
      ['user-said', 3],
    ])
  })

  it('leaves a summary already at its target where it is', () => {
    const events = log([
      { type: 'user-said', text: 'first' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'one' }] },
      compacted({ fromSeq: 1, throughSeq: 2, summary: 'two rows' }),
      { type: 'user-said', text: 'fourth' },
    ])

    expect(shape(summariesAtTarget(events))).toEqual([
      ['user-said', 1],
      ['assistant-said', 2],
      ['history-compacted', 3],
      ['user-said', 4],
    ])
  })

  it('places two summaries each at their own target, in their original order', () => {
    const events = log([
      { type: 'user-said', text: 'first' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'one' }] },
      { type: 'user-said', text: 'third' },
      compacted({ fromSeq: 1, throughSeq: 1, summary: 'the first row' }),
      compacted({ fromSeq: 2, throughSeq: 2, summary: 'the second row' }),
    ])

    expect(shape(summariesAtTarget(events))).toEqual([
      ['user-said', 1],
      ['history-compacted', 4],
      ['assistant-said', 2],
      ['history-compacted', 5],
      ['user-said', 3],
    ])
  })

  it('keeps an event inside the range above the summary', () => {
    const events = log([
      { type: 'user-said', text: 'first' },
      { type: 'context-loaded', slot: 'skills', key: 'skills', content: 'a skill' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'one' }] },
      { type: 'user-said', text: 'fourth' },
      compacted({ fromSeq: 1, throughSeq: 2, summary: 'two rows' }),
    ])

    expect(shape(summariesAtTarget(events))).toEqual([
      ['user-said', 1],
      ['context-loaded', 2],
      ['history-compacted', 5],
      ['assistant-said', 3],
      ['user-said', 4],
    ])
  })

  it('returns the same events when there is no summary', () => {
    const events = log([
      { type: 'user-said', text: 'first' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'one' }] },
    ])

    expect(shape(summariesAtTarget(events))).toEqual([
      ['user-said', 1],
      ['assistant-said', 2],
    ])
  })
})
