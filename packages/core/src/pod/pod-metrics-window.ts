import type { PodSample } from './pod-metrics'

export type PodMetricsWindow = {
  windowMs: number
  samples: number
  ramPeakBytes: number
  ramAvgBytes: number
  ramLimitBytes?: number | undefined
  ramPeakRatio?: number | undefined
  cpuPeakPercent: number
  cpuAvgPercent: number
  throttledRatio: number
  diskUsedBytes?: number | undefined
  diskLimitBytes?: number | undefined
  oomKills: number
}

const rounded = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const reversed = (samples: readonly PodSample[]): PodSample[] => [...samples].reverse()

const latestOf = (
  samples: readonly PodSample[],
  read: (sample: PodSample) => number | undefined,
): number | undefined => {
  for (const sample of reversed(samples)) {
    const value = read(sample)
    if (value !== undefined) return value
  }
  return undefined
}

export const podMetricsWindowOf = (args: {
  samples: readonly PodSample[]
  from: number
  to: number
  oomKillsBefore: number | null
}): PodMetricsWindow | null => {
  const inWindow = args.samples.filter((sample) => sample.at >= args.from && sample.at < args.to)
  if (inWindow.length === 0) return null

  const peakOf = (read: (sample: PodSample) => number): number =>
    Math.max(...inWindow.map((sample) => read(sample)))
  const averageOf = (read: (sample: PodSample) => number): number =>
    inWindow.reduce((sum, sample) => sum + read(sample), 0) / inWindow.length

  const ramPeakBytes = peakOf((sample) => sample.ramBytes)
  const ramLimitBytes = latestOf(inWindow, (sample) => sample.ramLimitBytes ?? undefined)
  const diskUsedBytes = latestOf(inWindow, (sample) => sample.diskUsedBytes)
  const diskLimitBytes = latestOf(inWindow, (sample) => sample.diskLimitBytes)
  const oomKillsLatest = latestOf(inWindow, (sample) => sample.oomKills) ?? 0
  const oomKillsBefore = args.oomKillsBefore ?? inWindow[0]?.oomKills ?? oomKillsLatest

  return {
    windowMs: args.to - args.from,
    samples: inWindow.length,
    ramPeakBytes,
    ramAvgBytes: Math.round(averageOf((sample) => sample.ramBytes)),
    ...(ramLimitBytes === undefined
      ? {}
      : { ramLimitBytes, ramPeakRatio: rounded(ramPeakBytes / ramLimitBytes, 3) }),
    cpuPeakPercent: rounded(
      peakOf((sample) => sample.cpuPercent),
      1,
    ),
    cpuAvgPercent: rounded(
      averageOf((sample) => sample.cpuPercent),
      1,
    ),
    throttledRatio: rounded(
      inWindow.filter((sample) => sample.throttled).length / inWindow.length,
      3,
    ),
    ...(diskUsedBytes === undefined ? {} : { diskUsedBytes }),
    ...(diskLimitBytes === undefined ? {} : { diskLimitBytes }),
    oomKills: Math.max(0, oomKillsLatest - oomKillsBefore),
  }
}
