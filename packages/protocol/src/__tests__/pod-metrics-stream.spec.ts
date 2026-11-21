import { describe, expect, it } from 'bun:test'

import { podMetricsStreamOutputSchema } from '../api'

async function* frames() {
  yield { type: 'sample' as const }
}

describe('pod metrics subscription output', () => {
  it('accepts the stream a subscription resolver returns', () => {
    expect(podMetricsStreamOutputSchema.safeParse(frames()).success).toBe(true)
  })

  it('rejects a single frame', () => {
    expect(podMetricsStreamOutputSchema.safeParse({ type: 'samples', samples: [] }).success).toBe(
      false,
    )
  })
})
