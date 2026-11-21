import { describe, expect, it } from 'bun:test'

import { podMetricsFrameSchema, podMetricsStreamOutputSchema } from '../api'

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

describe('pod metrics frame', () => {
  it('accepts the frame that says why the stream cannot report usage', () => {
    const parsed = podMetricsFrameSchema.safeParse({
      type: 'unavailable',
      reason: 'pod metrics are not readable',
    })
    expect(parsed.success).toBe(true)
  })

  it('requires the reason on an unavailable frame', () => {
    expect(podMetricsFrameSchema.safeParse({ type: 'unavailable' }).success).toBe(false)
  })
})
