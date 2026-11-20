import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  clamp,
  formatCpu,
  formatRam,
  gigabytes,
  latestOf,
  podMetricViewOf,
  ramPercentOf,
} from '../pod-metrics-model'
import {
  generatePodSeries,
  nextPodSample,
  POD_SAMPLE_COUNT,
  POD_SAMPLE_MS,
  POD_SERIES,
  POD_SIZES,
  POD_STATUS_RUNNING,
} from '../pod-metrics.fixtures'
import { PodMetricsCards, PodMetricsCombined, PodMetricsRows } from '../pod-metrics'
import type { PodMetricsProps } from '../pod-metrics'

const PROPS: PodMetricsProps = {
  status: POD_STATUS_RUNNING,
  sizes: POD_SIZES,
  series: POD_SERIES,
  throttled: false,
  oomKills: 0,
}

describe('pod metric formatting', () => {
  it('rounds CPU to whole percent', () => {
    expect(formatCpu(41.6)).toBe('42%')
  })

  it('prints gigabytes without a trailing zero', () => {
    expect(gigabytes(8)).toBe('8')
    expect(gigabytes(2.14)).toBe('2.1')
    expect(gigabytes(5.86)).toBe('5.9')
  })

  it('pairs used RAM with the limit', () => {
    expect(formatRam({ usedGb: 2.1, limitGb: 8 })).toBe('2.1 / 8 GB')
  })

  it('reads RAM as a share of the limit', () => {
    const sample = { t: 0, cpu: 10, ramGb: 2 }
    expect(ramPercentOf({ sample, limitGb: 8 })).toBe(25)
    expect(ramPercentOf({ sample: { ...sample, ramGb: 12 }, limitGb: 8 })).toBe(100)
    expect(ramPercentOf({ sample, limitGb: 0 })).toBe(0)
  })

  it('clamps into range', () => {
    expect(clamp({ value: 120, min: 0, max: 100 })).toBe(100)
  })

  it('takes the newest sample', () => {
    const series = [
      { t: 0, cpu: 10, ramGb: 1 },
      { t: 3_000, cpu: 20, ramGb: 2 },
    ]
    expect(latestOf(series)).toEqual({ t: 3_000, cpu: 20, ramGb: 2 })
    expect(latestOf([])).toBeNull()
  })
})

describe('pod metric view', () => {
  it('derives the limit from the pod size at two GB per vCPU', () => {
    const view = podMetricViewOf({
      series: [{ t: 0, cpu: 42, ramGb: 2.1 }],
      vcpus: 4,
    })
    expect(view.ramLimitGb).toBe(8)
    expect(view.cpuLabel).toBe('42%')
    expect(view.ramLabel).toBe('2.1 / 8 GB')
    expect(view.cpuValues).toEqual([42])
    expect(view.ramValues).toEqual([2.1])
  })

  it('falls back to four vCPUs and em dashes when nothing has been sampled', () => {
    const view = podMetricViewOf({ series: [] })
    expect(view.vcpus).toBe(4)
    expect(view.ramLimitGb).toBe(8)
    expect(view.cpuLabel).toBe('—')
    expect(view.ramLabel).toBe('—')
  })
})

describe('pod series fixtures', () => {
  it('generates fifteen minutes of samples every three seconds', () => {
    const series = generatePodSeries()
    expect(series).toHaveLength(POD_SAMPLE_COUNT)
    expect(series[1]?.t).toBe(POD_SAMPLE_MS)
    expect((series.at(-1)?.t ?? 0) / 1_000).toBe(897)
  })

  it('bursts under 95 percent with one install spike', () => {
    const series = generatePodSeries()
    const cpu = series.map((sample) => sample.cpu)
    expect(Math.min(...cpu)).toBeGreaterThanOrEqual(5)
    expect(Math.max(...cpu)).toBeLessThanOrEqual(95)
    expect(Math.max(...cpu)).toBeGreaterThan(85)
  })

  it('ramps RAM from 1.2 to 5.8 GB of the eight the pod owns', () => {
    const series = generatePodSeries()
    expect(series[0]?.ramGb).toBeCloseTo(1.2, 0)
    expect(series.at(-1)?.ramGb).toBeCloseTo(5.8, 0)
  })

  it('keeps the last series stable enough for snapshots of the same seed', () => {
    expect(generatePodSeries({ seed: 3 })).toEqual(generatePodSeries({ seed: 3 }))
  })

  it('appends a live sample without leaving the window', () => {
    const series = generatePodSeries({ samples: 4 })
    const next = nextPodSample({ series, random: () => 1 })
    expect(next.t).toBe(series.length * POD_SAMPLE_MS)
    expect(next.cpu).toBeGreaterThan(0)
    expect(next.ramGb).toBeGreaterThan(0)
  })
})

describe('pod metrics sections', () => {
  it('rows show the current values and the resize control', () => {
    const html = renderToStaticMarkup(<PodMetricsRows {...PROPS} />)
    expect(html).toContain('CPU')
    expect(html).toContain('RAM')
    expect(html).toContain('4 vCPU · 8 GB')
  })

  it('cards split the reading into CPU and RAM', () => {
    const html = renderToStaticMarkup(<PodMetricsCards {...PROPS} />)
    expect(html).toContain('of 4 vCPU')
    expect(html).toContain('of 8 GB')
  })

  it('combined keeps the window caption and the size in the header', () => {
    const html = renderToStaticMarkup(<PodMetricsCombined {...PROPS} />)
    expect(html).toContain('Last 15 min')
    expect(html).toContain('4 vCPU · 8 GB')
  })

  it('surfaces throttling and OOM kills only when they happened', () => {
    const quiet = renderToStaticMarkup(<PodMetricsRows {...PROPS} />)
    expect(quiet).not.toContain('Throttled')
    const loud = renderToStaticMarkup(<PodMetricsRows {...PROPS} throttled oomKills={2} />)
    expect(loud).toContain('Throttled')
    expect(loud).toContain('2 OOM kills')
  })
})
