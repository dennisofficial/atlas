import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, type EventDraft } from '../../events/body'
import type { Event } from '../../events/envelope'
import { toThreadId, toCallId, toEventId, toRunId } from '../../events/ids'
import { stampDrafts } from '../../events/stamp'
import { contextTokens, contextTokensOf, lastStepUsage } from '../usage'

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

describe('what the last request carried', () => {
  it('has nothing to say before a step reports its usage', () => {
    expect(contextTokens(null)).toBeNull()
  })

  it('takes the numbers the model reported', () => {
    expect(contextTokens({ inputTokens: 41_000, outputTokens: 900 })).toBe(41_900)
  })

  it('reads a report of nothing as nothing, not as a reason to guess', () => {
    expect(contextTokens({ inputTokens: 0, outputTokens: 0 })).toBe(0)
  })

  it('refuses a negative count', () => {
    expect(contextTokens({ inputTokens: -5, outputTokens: 10 })).toBe(10)
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
    expect(contextTokensOf(events)).toBeNull()
  })
})
