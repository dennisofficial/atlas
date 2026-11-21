import { clamp, type PodMetricsSample } from './pod-metrics-model'
import {
  AGENT37_POD_SHAPES,
  type PodShape,
  type UnavailablePodShape,
  vercelPodShapesOf,
} from './pod-shapes'
import { EPodState } from './pod-status'

export const POD_SAMPLE_MS = 3_000
export const POD_SAMPLE_COUNT = 300

export const POD_STATUS_RUNNING = { state: EPodState.Running, vcpus: 4 } as const

export const POD_SECTION_SHAPE: PodShape = { vcpus: 4, memoryGb: 16 }

export const POD_SECTION_SHAPES: readonly PodShape[] = AGENT37_POD_SHAPES

export const VERCEL_PRO_SHAPE: PodShape = { vcpus: 4, memoryGb: 8 }

export const VERCEL_PRO_SHAPES: readonly PodShape[] = vercelPodShapesOf({ maxVcpus: 8 })

export const VERCEL_PLAN_CAP_SHAPES: readonly PodShape[] = vercelPodShapesOf({ maxVcpus: 32 })

export const VERCEL_HOBBY_UNAVAILABLE: readonly UnavailablePodShape[] = [
  { shape: { vcpus: 6, memoryGb: 12 }, reason: 'Needs Pro plan' },
  { shape: { vcpus: 8, memoryGb: 16 }, reason: 'Needs Pro plan' },
]

export const POD_SIZES: readonly number[] = [
  1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
]

const CPU_FLOOR = 5
const CPU_CEILING = 95
const RAM_FLOOR = 1.2
const RAM_CEILING = 5.8
const RAM_SPREAD = RAM_CEILING - RAM_FLOOR

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PodSeriesOptions {
  samples?: number | undefined
  seed?: number | undefined
}

export function generatePodSeries({
  samples = POD_SAMPLE_COUNT,
  seed = 11,
}: PodSeriesOptions = {}): PodMetricsSample[] {
  const random = mulberry32(seed)
  const spikeAt = Math.round(samples * 0.62)
  return Array.from({ length: samples }, (_, index) => {
    const phase = samples <= 1 ? 1 : index / (samples - 1)
    const swell = 24 + 18 * Math.sin(phase * Math.PI * 4.8) + 8 * Math.sin(phase * Math.PI * 18)
    const install = 74 * Math.exp(-((index - spikeAt) ** 2) / (2 * 11 ** 2))
    return {
      t: index * POD_SAMPLE_MS,
      cpu: clamp({
        value: swell + install + (random() - 0.5) * 12,
        min: CPU_FLOOR,
        max: CPU_CEILING,
      }),
      ramGb: clamp({
        value: RAM_FLOOR + RAM_SPREAD * phase ** 0.8 + (random() - 0.5) * 0.14,
        min: RAM_FLOOR - 0.1,
        max: RAM_CEILING + 0.4,
      }),
    }
  })
}

export const POD_SERIES: readonly PodMetricsSample[] = generatePodSeries()

export const POD_DISK_GB = 20

const withDiskOf = (series: readonly PodMetricsSample[], limitGb: number) =>
  series.map((sample, index) => ({
    ...sample,
    diskUsedGb: 11 + (index / Math.max(1, series.length - 1)) * 3.2,
    diskLimitGb: limitGb,
  }))

export const POD_SERIES_WITH_DISK: readonly PodMetricsSample[] = withDiskOf(POD_SERIES, POD_DISK_GB)

export const POD_SERIES_DISK_FULL: readonly PodMetricsSample[] = withDiskOf(POD_SERIES, 100)

export function nextPodSample({
  series,
  random = Math.random,
}: {
  series: readonly PodMetricsSample[]
  random?: (() => number) | undefined
}): PodMetricsSample {
  const last = series.at(-1)
  const previousCpu = last?.cpu ?? 18
  const previousRam = last?.ramGb ?? RAM_FLOOR
  return {
    t: (last?.t ?? 0) + POD_SAMPLE_MS,
    cpu: clamp({
      value: previousCpu + (random() - 0.5) * 26 + (24 - previousCpu) * 0.1,
      min: CPU_FLOOR,
      max: CPU_CEILING,
    }),
    ramGb: clamp({
      value: previousRam + (random() - 0.5) * 0.09 + 0.004,
      min: RAM_FLOOR - 0.1,
      max: RAM_CEILING + 0.6,
    }),
    ...(last?.diskUsedGb === undefined
      ? {}
      : { diskUsedGb: last.diskUsedGb, diskLimitGb: last.diskLimitGb }),
  }
}
