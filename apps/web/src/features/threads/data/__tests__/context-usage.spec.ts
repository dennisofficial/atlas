import { describe, expect, it } from 'bun:test'

import { stampDrafts, toEventId, toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'
import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import { contextUsageOf } from '../context-usage'

const models: ModelOption[] = [
  { id: 'anthropic/opus', label: 'Opus', contextTokens: 200_000 },
  { id: 'local/mystery', label: 'Mystery' },
  { id: 'local/zero', label: 'Zero', contextTokens: 0 },
]

const eventsFrom = (drafts: readonly EventDraft[]) =>
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

describe('contextUsageOf', () => {
  it('reads the last step usage from the transcript against the selected window', () => {
    const events = eventsFrom([
      { type: 'user-said', text: 'hi' },
      {
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'ok' }],
        usage: { inputTokens: 40_000, outputTokens: 2_000 },
      },
    ])
    expect(contextUsageOf({ events, selectedId: 'anthropic/opus', models })).toEqual({
      used: 42_000,
      limit: 200_000,
    })
  })

  it('falls back to the event estimate before any step reported', () => {
    expect(contextUsageOf({ events: [], selectedId: 'anthropic/opus', models })).toEqual({
      used: 0,
      limit: 200_000,
    })
  })

  it('hides the meter for unknown, missing, or zero windows', () => {
    for (const selectedId of ['local/mystery', 'local/zero', 'nope']) {
      expect(contextUsageOf({ events: [], selectedId, models })).toBeNull()
    }
  })
})
