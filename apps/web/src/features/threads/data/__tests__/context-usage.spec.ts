import { describe, expect, it } from 'bun:test'

import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import { contextUsageOf } from '../context-usage'

const models: ModelOption[] = [
  { id: 'anthropic/opus', label: 'Opus', contextTokens: 200_000 },
  { id: 'local/mystery', label: 'Mystery' },
  { id: 'local/zero', label: 'Zero', contextTokens: 0 },
]

describe('contextUsageOf', () => {
  it('uses the reported usage against the selected model window', () => {
    expect(
      contextUsageOf({
        reported: { inputTokens: 40_000, outputTokens: 2_000 },
        events: [],
        selectedId: 'anthropic/opus',
        models,
      }),
    ).toEqual({ used: 42_000, limit: 200_000 })
  })

  it('falls back to the event estimate when nothing is reported', () => {
    const usage = contextUsageOf({
      reported: null,
      events: [],
      selectedId: 'anthropic/opus',
      models,
    })
    expect(usage).toEqual({ used: 0, limit: 200_000 })
  })

  it('hides the meter for unknown, missing, or zero windows', () => {
    for (const selectedId of ['local/mystery', 'local/zero', 'nope']) {
      expect(contextUsageOf({ reported: null, events: [], selectedId, models })).toBeNull()
    }
  })
})
