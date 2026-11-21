import { describe, expect, it } from 'bun:test'

import { type PodCgroupCounters, podSampleOf } from '../pod-metrics'

const counters = (over: Partial<PodCgroupCounters> = {}): PodCgroupCounters => ({
  usageUsec: 0,
  throttledUsec: 0,
  memoryBytes: 0,
  memoryLimitBytes: 8 * 1024 ** 3,
  oomKills: 0,
  ...over,
})

describe('podSampleOf', () => {
  it('reports cpu as a share of the provisioned vcpus', () => {
    const sample = podSampleOf({
      prev: counters({ usageUsec: 1_000_000 }),
      next: counters({ usageUsec: 4_000_000 }),
      intervalMs: 3_000,
      vcpus: 4,
      at: 1,
    })
    expect(sample.cpuPercent).toBe(25)
  })

  it('reports a single busy vcpu against the provisioned count', () => {
    const sample = podSampleOf({
      prev: counters(),
      next: counters({ usageUsec: 3_000_000 }),
      intervalMs: 3_000,
      vcpus: 8,
      at: 1,
    })
    expect(sample.cpuPercent).toBe(12.5)
  })

  it('reads memory and its limit from the counters', () => {
    const sample = podSampleOf({
      prev: counters(),
      next: counters({ memoryBytes: 2 * 1024 ** 3, memoryLimitBytes: 16 * 1024 ** 3 }),
      intervalMs: 3_000,
      vcpus: 4,
      at: 7,
    })
    expect(sample.ramBytes).toBe(2 * 1024 ** 3)
    expect(sample.ramLimitBytes).toBe(16 * 1024 ** 3)
    expect(sample.at).toBe(7)
  })

  it('keeps an unlimited memory ceiling null', () => {
    const sample = podSampleOf({
      prev: counters(),
      next: counters({ memoryLimitBytes: null }),
      intervalMs: 3_000,
      vcpus: 4,
      at: 1,
    })
    expect(sample.ramLimitBytes).toBeNull()
  })

  it('flags throttling only when throttled time grew', () => {
    const throttled = podSampleOf({
      prev: counters({ throttledUsec: 10 }),
      next: counters({ throttledUsec: 20 }),
      intervalMs: 3_000,
      vcpus: 4,
      at: 1,
    })
    const quiet = podSampleOf({
      prev: counters({ throttledUsec: 20 }),
      next: counters({ throttledUsec: 20 }),
      intervalMs: 3_000,
      vcpus: 4,
      at: 1,
    })
    expect(throttled.throttled).toBe(true)
    expect(quiet.throttled).toBe(false)
  })

  it('carries the cumulative oom kill count', () => {
    const sample = podSampleOf({
      prev: counters(),
      next: counters({ oomKills: 2 }),
      intervalMs: 3_000,
      vcpus: 4,
      at: 1,
    })
    expect(sample.oomKills).toBe(2)
  })

  it('treats a counter reset as no usage rather than a negative share', () => {
    const sample = podSampleOf({
      prev: counters({ usageUsec: 9_000_000, throttledUsec: 50 }),
      next: counters({ usageUsec: 1_000_000, throttledUsec: 10 }),
      intervalMs: 3_000,
      vcpus: 4,
      at: 1,
    })
    expect(sample.cpuPercent).toBe(0)
    expect(sample.throttled).toBe(false)
  })

  it('reports no cpu share when the pod has no vcpus', () => {
    const sample = podSampleOf({
      prev: counters(),
      next: counters({ usageUsec: 3_000_000 }),
      intervalMs: 3_000,
      vcpus: 0,
      at: 1,
    })
    expect(sample.cpuPercent).toBe(0)
  })
})
