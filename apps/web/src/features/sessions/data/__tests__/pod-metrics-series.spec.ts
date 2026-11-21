import { describe, expect, it } from 'bun:test'

import type { PodSample } from '@dltech/atlas-protocol'

import { POD_METRICS_SERIES_LIMIT, type PodMetricsSample, seriesAfter } from '../pod-metrics-series'

const sample = (at: number, ramBytes = 2 * 1024 ** 3): PodSample => ({
  at,
  cpuPercent: 42,
  ramBytes,
  ramLimitBytes: 8 * 1024 ** 3,
  throttled: false,
  oomKills: 0,
})

const mapped = (at: number, ramGb = 2): PodMetricsSample => ({
  t: at,
  cpu: 42,
  ramGb,
  throttled: false,
  oomKills: 0,
})

describe('seriesAfter', () => {
  it('replaces the series with a backlog frame', () => {
    const series = seriesAfter({
      series: [mapped(1)],
      frame: { type: 'samples', samples: [sample(1_000), sample(4_000)] },
    })
    expect(series).toEqual([mapped(1_000), mapped(4_000)])
  })

  it('appends a live sample in gigabytes', () => {
    const series = seriesAfter({
      series: [mapped(1_000)],
      frame: { type: 'sample', sample: sample(4_000, 1024 ** 3) },
    })
    expect(series).toEqual([mapped(1_000), mapped(4_000, 1)])
  })

  it('keeps the series bounded to the ring size', () => {
    const series = Array.from({ length: POD_METRICS_SERIES_LIMIT }, (_value, index) =>
      mapped(index * 1_000),
    )
    const grown = seriesAfter({
      series,
      frame: { type: 'sample', sample: sample(POD_METRICS_SERIES_LIMIT * 1_000) },
    })
    expect(grown).toHaveLength(POD_METRICS_SERIES_LIMIT)
    expect(grown[0]?.t).toBe(1_000)
    expect(grown.at(-1)?.t).toBe(POD_METRICS_SERIES_LIMIT * 1_000)
  })
})
