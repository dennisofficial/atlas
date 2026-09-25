import { describe, expect, it } from 'bun:test'

import { channelSignalSchema } from '../signal-wire'

describe('channelSignalSchema', () => {
  it('accepts every signal kind with its full payload', () => {
    const cases: unknown[] = [
      { type: 'step-started', stepId: 's1' },
      {
        type: 'chunk',
        stepId: 's1',
        chunk: { type: 'text-delta', id: 't1', text: 'hi' },
      },
      { type: 'step-ended', stepId: 's1', end: 'completed', supersededBy: null },
      { type: 'tool-output', callId: 'c1', text: 'out' },
      { type: 'events-appended' },
      { type: 'retry-waiting', attempt: 1, maxAttempts: 10, delayMs: 500, reason: 'network' },
      { type: 'retry-cleared' },
    ]
    for (const value of cases) {
      expect(channelSignalSchema.safeParse(value).success).toBe(true)
    }
  })

  it('rejects a payload that carries only a known type string', () => {
    expect(channelSignalSchema.safeParse({ type: 'chunk' }).success).toBe(false)
    expect(channelSignalSchema.safeParse({ type: 'retry-waiting' }).success).toBe(false)
  })

  it('rejects an unknown type', () => {
    expect(channelSignalSchema.safeParse({ type: 'made-up' }).success).toBe(false)
  })
})
