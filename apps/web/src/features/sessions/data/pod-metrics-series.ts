import type { PodMetricsFrame, PodSample } from '@dltech/atlas-protocol'

export const POD_METRICS_SERIES_LIMIT = 300

const GIGABYTE = 1024 ** 3

export type PodMetricsSample = {
  t: number
  cpu: number
  ramGb: number
  throttled: boolean
  oomKills: number
}

export const podMetricsSampleOf = (sample: PodSample): PodMetricsSample => ({
  t: sample.at,
  cpu: sample.cpuPercent,
  ramGb: sample.ramBytes / GIGABYTE,
  throttled: sample.throttled,
  oomKills: sample.oomKills,
})

const bounded = (samples: PodMetricsSample[]): PodMetricsSample[] =>
  samples.slice(-POD_METRICS_SERIES_LIMIT)

export const seriesAfter = (args: {
  series: readonly PodMetricsSample[]
  frame: PodMetricsFrame
}): PodMetricsSample[] =>
  args.frame.type === 'samples'
    ? bounded(args.frame.samples.map(podMetricsSampleOf))
    : bounded([...args.series, podMetricsSampleOf(args.frame.sample)])
