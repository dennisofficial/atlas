import {
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { tldrPrompt } from '../tldr'

const events = (drafts: readonly EventDraft[]): Event[] =>
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

describe('tldrPrompt', () => {
  it('runs from the anchor message to the end of the turn', () => {
    const all = events([
      { type: 'user-said', text: 'earlier ask' },
      { type: 'user-said', text: 'latest ask' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'fixed the throttle' }] },
    ])

    const prompt = tldrPrompt({ events: all, anchorSeq: 2, throughSeq: 3 })

    expect(prompt).not.toContain('earlier ask')
    expect(prompt).toContain('latest ask')
    expect(prompt).toContain('fixed the throttle')
  })

  it('keeps the whole turn however long it runs', () => {
    const all = events(
      Array.from({ length: 60 }, (_, index) => ({
        type: 'user-said' as const,
        text: `chunk ${index} ${'a'.repeat(3_800)}`,
      })),
    )

    const prompt = tldrPrompt({ events: all, anchorSeq: 1, throughSeq: 60 })

    expect(prompt?.length).toBeGreaterThan(200_000)
    expect(prompt).toContain('chunk 0 ')
    expect(prompt).toContain('chunk 59 ')
  })

  it('clips individual payloads instead of dropping the turn', () => {
    const all = events([
      { type: 'user-said', text: 'latest ask' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'z'.repeat(9_000) }] },
    ])

    const prompt = tldrPrompt({ events: all, anchorSeq: 1, throughSeq: 2 })

    expect(prompt).toContain('z'.repeat(4_000))
    expect(prompt).not.toContain('z'.repeat(4_001))
  })

  it('asks nothing when the range has no transcript', () => {
    expect(tldrPrompt({ events: [], anchorSeq: 1, throughSeq: 1 })).toBeNull()
  })
})
