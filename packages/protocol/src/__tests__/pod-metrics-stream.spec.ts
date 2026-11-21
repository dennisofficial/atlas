import { describe, expect, it } from 'bun:test'

import { podMetricsFrameSchema, podMetricsStreamOutputSchema } from '../api'
import { podSampleSchema } from '../ops/metrics'

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

describe('pod sample disk fields', () => {
  const sample = {
    at: 1_000,
    cpuPercent: 12,
    ramBytes: 512,
    ramLimitBytes: 1024,
    throttled: false,
    oomKills: 0,
  }

  it('accepts a sample from a daemon that does not report disk', () => {
    expect(podSampleSchema.safeParse(sample).success).toBe(true)
  })

  it('accepts a sample that reports disk use and its limit', () => {
    const parsed = podSampleSchema.safeParse({
      ...sample,
      diskUsedBytes: 14 * 1024 ** 3,
      diskLimitBytes: 20 * 1024 ** 3,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a disk figure that is not a byte count', () => {
    expect(podSampleSchema.safeParse({ ...sample, diskUsedBytes: -1 }).success).toBe(false)
    expect(podSampleSchema.safeParse({ ...sample, diskLimitBytes: 1.5 }).success).toBe(false)
  })
})
