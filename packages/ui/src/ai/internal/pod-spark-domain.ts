import { clamp, formatCpu, formatRam } from '../pod-metrics-model'

export const POD_SPARK_SAMPLE_MS = 3_000
export const POD_SPARK_WINDOW_SAMPLES = 300

export const POD_SERIES_WINDOW_MS = POD_SPARK_SAMPLE_MS * POD_SPARK_WINDOW_SAMPLES

const MIN_DOMAIN_SPAN = 10
const DOMAIN_PADDING = 0.08

export interface PodSparkPoint {
  at: number
  cpu: number
  ram: number
  ramGb: number
}

export interface PodSparkTip {
  time: string
  cpu: string
  ram: string
}

export function podSparkDomainOf(values: readonly number[]): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return [0, 100]
  const low = Math.min(...finite)
  const high = Math.max(...finite)
  const half = (Math.max(high - low, MIN_DOMAIN_SPAN) / 2) * (1 + DOMAIN_PADDING)
  const center = (low + high) / 2
  return [
    clamp({ value: Math.floor(center - half), min: 0, max: 100 }),
    clamp({ value: Math.ceil(center + half), min: 0, max: 100 }),
  ]
}

export function podSparkWindowOf({
  samples,
}: {
  samples: readonly { at: number }[]
}): [number, number] {
  const end = samples.at(-1)?.at ?? 0
  return [end - POD_SERIES_WINDOW_MS, end]
}

export function podSparkTimeAt({
  x,
  width,
  from,
  to,
}: {
  x: number
  width: number
  from: number
  to: number
}): number {
  if (width <= 0 || to <= from) return to
  return from + clamp({ value: x / width, min: 0, max: 1 }) * (to - from)
}

export function podSparkNearest({
  samples,
  at,
}: {
  samples: readonly { at: number }[]
  at: number
}): number | null {
  if (samples.length === 0) return null
  let nearest = 0
  let nearestGap = Number.POSITIVE_INFINITY
  for (const [index, sample] of samples.entries()) {
    const gap = Math.abs(sample.at - at)
    if (gap < nearestGap) {
      nearest = index
      nearestGap = gap
    }
  }
  return nearest
}

export function podSparkTipOf({
  at,
  cpu,
  usedGb,
  limitGb,
}: {
  at: number
  cpu: number
  usedGb: number
  limitGb: number
}): PodSparkTip {
  return {
    time: timeLabelOf(at),
    cpu: formatCpu(cpu),
    ram: formatRam({ usedGb, limitGb }),
  }
}

function timeLabelOf(at: number): string {
  const date = new Date(at)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}
