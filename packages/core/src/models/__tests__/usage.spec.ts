import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, type EventDraft } from '../../events/body'
import type { Event } from '../../events/envelope'
import { toThreadId, toCallId, toEventId, toRunId } from '../../events/ids'
import { stampDrafts } from '../../events/stamp'
import { contextTokens, contextTokensOf, estimateEventTokens, lastStepUsage } from '../usage'

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

describe('estimating what the thread will carry into the next turn', () => {
  it('counts nothing for an empty thread', () => {
    expect(estimateEventTokens([])).toBe(0)
  })

  it('counts what the operator said', () => {
    const events = eventsFrom([{ type: 'user-said', text: 'x'.repeat(400) }])
    expect(estimateEventTokens(events)).toBe(100)
  })

  it('counts thinking as well as the reply, since both go back up', () => {
    const withReasoning = eventsFrom([
      {
        type: 'assistant-said',
        parts: [
          { type: 'reasoning', text: 'y'.repeat(400) },
          { type: 'text', text: 'z'.repeat(400) },
        ],
      },
    ])

    expect(estimateEventTokens(withReasoning)).toBe(200)
  })

  it('counts a tool call and its result, which are the bulk of a long turn', () => {
    const events = eventsFrom([
      {
        type: 'tool-called',
        callId: toCallId('c1'),
        name: 'read',
        input: { path: '/a' },
        ordinal: 1,
      },
      {
        type: 'tool-result',
        callId: toCallId('c1'),
        name: 'read',
        output: { text: 'q'.repeat(400) },
      },
    ])

    expect(estimateEventTokens(events)).toBeGreaterThan(100)
  })

  it('grows as the thread grows', () => {
    const short = eventsFrom([{ type: 'user-said', text: 'hello' }])
    const long = eventsFrom([
      { type: 'user-said', text: 'hello' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'a'.repeat(4000) }] },
    ])

    expect(estimateEventTokens(long)).toBeGreaterThan(estimateEventTokens(short))
  })

  it('ignores the bookkeeping events that never reach the model', () => {
    const events = eventsFrom([
      { type: 'approval-requested', callId: toCallId('c1'), reason: 'writes outside the repo' },
      { type: 'assistant-said', parts: [] },
    ])

    expect(estimateEventTokens(events)).toBe(0)
  })
})

describe('what the next request will carry', () => {
  const events = eventsFrom([{ type: 'user-said', text: 'x'.repeat(400) }])

  it('falls back to the estimate until a step has reported its usage', () => {
    expect(contextTokens({ reported: null, events })).toBe(estimateEventTokens(events))
  })

  it('trusts the model over the estimate once a step has reported', () => {
    expect(contextTokens({ reported: { inputTokens: 41_000, outputTokens: 900 }, events })).toBe(
      41_900,
    )
  })

  it('reads a report of nothing as nothing, not as a reason to guess again', () => {
    expect(contextTokens({ reported: { inputTokens: 0, outputTokens: 0 }, events })).toBe(0)
  })

  it('refuses a negative count', () => {
    expect(contextTokens({ reported: { inputTokens: -5, outputTokens: 10 }, events })).toBe(10)
  })
})

describe('reading the last step usage back from the transcript', () => {
  const said = (usage?: { inputTokens: number; outputTokens: number }): EventDraft => ({
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'ok' }],
    ...(usage === undefined ? {} : { usage }),
  })

  it('has nothing before any step reported', () => {
    expect(lastStepUsage(eventsFrom([{ type: 'user-said', text: 'hi' }, said()]))).toBeNull()
  })

  it('takes the latest step, so the meter rises call by call', () => {
    const events = eventsFrom([
      said({ inputTokens: 10_000, outputTokens: 500 }),
      {
        type: 'tool-called',
        callId: toCallId('c1'),
        name: 'bash',
        input: {},
        ordinal: 0,
        usage: { inputTokens: 12_000, outputTokens: 300 },
      },
      { type: 'user-said', text: 'next' },
    ])
    expect(lastStepUsage(events)).toEqual({ inputTokens: 12_000, outputTokens: 300 })
    expect(contextTokensOf(events)).toBe(12_300)
  })

  it('forgets a reading a later compaction made stale', () => {
    const events = eventsFrom([
      said({ inputTokens: 90_000, outputTokens: 500 }),
      {
        type: 'history-compacted',
        anchor: ECompactionAnchor.Prefix,
        fromSeq: 1,
        throughSeq: 1,
        summary: 'x'.repeat(400),
        replaced: 1,
      },
    ])
    expect(lastStepUsage(events)).toBeNull()
    expect(contextTokensOf(events)).toBe(estimateEventTokens(events))
  })
})
