import type { PodMetricsFrame, PodSample } from '@dltech/atlas-protocol'

export const POD_METRICS_SERIES_LIMIT = 300

const GIGABYTE = 1024 ** 3

export type PodMetricsSample = {
  t: number
  cpu: number
  ramGb: number
  throttled: boolean
  oomKills: number
  oomEvents?: number | undefined
  commandRamLimitGb?: number | undefined
  diskUsedGb?: number | undefined
  diskLimitGb?: number | undefined
}

export const podMetricsSampleOf = (sample: PodSample): PodMetricsSample => ({
  t: sample.at,
  cpu: sample.cpuPercent,
  ramGb: sample.ramBytes / GIGABYTE,
  throttled: sample.throttled,
  oomKills: sample.oomKills,
  ...(sample.oomEvents === undefined ? {} : { oomEvents: sample.oomEvents }),
  ...(sample.commandRamLimitBytes === undefined
    ? {}
    : { commandRamLimitGb: sample.commandRamLimitBytes / GIGABYTE }),
  ...(sample.diskUsedBytes === undefined ? {} : { diskUsedGb: sample.diskUsedBytes / GIGABYTE }),
  ...(sample.diskLimitBytes === undefined ? {} : { diskLimitGb: sample.diskLimitBytes / GIGABYTE }),
})

const bounded = (samples: PodMetricsSample[]): PodMetricsSample[] =>
  samples.slice(-POD_METRICS_SERIES_LIMIT)

export const seriesAfter = (args: {
  series: readonly PodMetricsSample[]
  frame: PodMetricsFrame
}): PodMetricsSample[] => {
  if (args.frame.type === 'samples') return bounded(args.frame.samples.map(podMetricsSampleOf))
  if (args.frame.type === 'sample')
    return bounded([...args.series, podMetricsSampleOf(args.frame.sample)])
  return [...args.series]
}
