import { describe, expect, it } from 'bun:test'

import type { PodSample } from '../pod-metrics'
import { podMetricsWindowOf } from '../pod-metrics-window'

const sampleOf = (over: Partial<PodSample> = {}): PodSample => ({
  at: 0,
  cpuPercent: 0,
  ramBytes: 0,
  ramLimitBytes: null,
  throttled: false,
  oomKills: 0,
  ...over,
})

describe('podMetricsWindowOf', () => {
  it('answers null when no sample lands in the window', () => {
    const samples = [sampleOf({ at: 999 }), sampleOf({ at: 2_000 })]
    expect(podMetricsWindowOf({ samples, from: 1_000, to: 2_000, oomKillsBefore: null })).toBeNull()
  })

  it('reads only the samples inside the half-open window', () => {
    const samples = [
      sampleOf({ at: 999, cpuPercent: 100 }),
      sampleOf({ at: 1_000, cpuPercent: 10 }),
      sampleOf({ at: 1_999, cpuPercent: 20 }),
      sampleOf({ at: 2_000, cpuPercent: 100 }),
    ]
    const window = podMetricsWindowOf({ samples, from: 1_000, to: 2_000, oomKillsBefore: null })
    expect(window?.samples).toBe(2)
    expect(window?.cpuPeakPercent).toBe(20)
  })

  it('summarises cpu as a peak and an average to one decimal', () => {
    const samples = [
      sampleOf({ at: 1, cpuPercent: 10 }),
      sampleOf({ at: 2, cpuPercent: 25 }),
      sampleOf({ at: 3, cpuPercent: 30 }),
    ]
    const window = podMetricsWindowOf({ samples, from: 0, to: 10, oomKillsBefore: null })
    expect(window?.cpuPeakPercent).toBe(30)
    expect(window?.cpuAvgPercent).toBe(21.7)
  })

  it('summarises memory as a peak, a rounded average and the latest limit', () => {
    const samples = [
      sampleOf({ at: 1, ramBytes: 1_000, ramLimitBytes: 8_000 }),
      sampleOf({ at: 2, ramBytes: 2_000, ramLimitBytes: 4_000 }),
      sampleOf({ at: 3, ramBytes: 1_500, ramLimitBytes: null }),
    ]
    const window = podMetricsWindowOf({ samples, from: 0, to: 10, oomKillsBefore: null })
    expect(window?.ramPeakBytes).toBe(2_000)
    expect(window?.ramAvgBytes).toBe(1_500)
    expect(window?.ramLimitBytes).toBe(4_000)
    expect(window?.ramPeakRatio).toBe(0.5)
  })

  it('omits the ratio when the pod reports no memory limit', () => {
    const window = podMetricsWindowOf({
      samples: [sampleOf({ at: 1, ramBytes: 1_000 })],
      from: 0,
      to: 10,
      oomKillsBefore: null,
    })
    expect(window?.ramLimitBytes).toBeUndefined()
    expect(window?.ramPeakRatio).toBeUndefined()
  })

  it('reports the share of throttled samples', () => {
    const samples = [
      sampleOf({ at: 1, throttled: true }),
      sampleOf({ at: 2, throttled: false }),
      sampleOf({ at: 3, throttled: false }),
    ]
    const window = podMetricsWindowOf({ samples, from: 0, to: 10, oomKillsBefore: null })
    expect(window?.throttledRatio).toBe(0.333)
  })

  it('reads the latest disk figures that the pod reported', () => {
    const samples = [
      sampleOf({ at: 1, diskUsedBytes: 10, diskLimitBytes: 100 }),
      sampleOf({ at: 2, diskUsedBytes: 20 }),
    ]
    const window = podMetricsWindowOf({ samples, from: 0, to: 10, oomKillsBefore: null })
    expect(window?.diskUsedBytes).toBe(20)
    expect(window?.diskLimitBytes).toBe(100)
  })

  it('counts oom kills from the first sample when nothing was carried in', () => {
    const samples = [sampleOf({ at: 1, oomKills: 2 }), sampleOf({ at: 2, oomKills: 5 })]
    const window = podMetricsWindowOf({ samples, from: 0, to: 10, oomKillsBefore: null })
    expect(window?.oomKills).toBe(3)
  })

  it('counts oom kills from the carried counter', () => {
    const samples = [sampleOf({ at: 1, oomKills: 5 }), sampleOf({ at: 2, oomKills: 6 })]
    const window = podMetricsWindowOf({ samples, from: 0, to: 10, oomKillsBefore: 4 })
    expect(window?.oomKills).toBe(2)
  })

  it('never reports a negative oom count after the counter resets', () => {
    const samples = [sampleOf({ at: 1, oomKills: 1 })]
    const window = podMetricsWindowOf({ samples, from: 0, to: 10, oomKillsBefore: 9 })
    expect(window?.oomKills).toBe(0)
  })

  it('reports the elapsed time of the window', () => {
    const window = podMetricsWindowOf({
      samples: [sampleOf({ at: 1_000 })],
      from: 1_000,
      to: 61_000,
      oomKillsBefore: null,
    })
    expect(window?.windowMs).toBe(60_000)
  })
})
