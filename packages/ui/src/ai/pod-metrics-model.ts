import { ramOf } from './pod-status'

export interface PodMetricsSample {
  t: number
  cpu: number
  ramGb: number
}

export interface PodMetricView {
  vcpus: number
  cpuPercent: number
  ramGb: number
  ramLimitGb: number
  ramPercent: number
  cpuLabel: string
  ramLabel: string
  cpuValues: number[]
  ramValues: number[]
}

const DEFAULT_VCPUS = 4

export function clamp({ value, min, max }: { value: number; min: number; max: number }): number {
  return Math.min(Math.max(value, min), max)
}

export function latestOf(series: readonly PodMetricsSample[]): PodMetricsSample | null {
  return series.at(-1) ?? null
}

export function ramPercentOf({
  sample,
  limitGb,
}: {
  sample: PodMetricsSample
  limitGb: number
}): number {
  if (limitGb <= 0) return 0
  return clamp({ value: (sample.ramGb / limitGb) * 100, min: 0, max: 100 })
}

export function formatCpu(percent: number): string {
  return `${Math.round(percent)}%`
}

export function gigabytes(gb: number): string {
  const rounded = Math.round(gb * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatRam({ usedGb, limitGb }: { usedGb: number; limitGb: number }): string {
  return `${gigabytes(usedGb)} / ${gigabytes(limitGb)} GB`
}

export function podMetricViewOf({
  series,
  vcpus = DEFAULT_VCPUS,
}: {
  series: readonly PodMetricsSample[]
  vcpus?: number | undefined
}): PodMetricView {
  const current = latestOf(series)
  const ramLimitGb = ramOf(vcpus)
  return {
    vcpus,
    cpuPercent: current === null ? 0 : current.cpu,
    ramGb: current === null ? 0 : current.ramGb,
    ramLimitGb,
    ramPercent: current === null ? 0 : ramPercentOf({ sample: current, limitGb: ramLimitGb }),
    cpuLabel: current === null ? '—' : formatCpu(current.cpu),
    ramLabel: current === null ? '—' : formatRam({ usedGb: current.ramGb, limitGb: ramLimitGb }),
    cpuValues: series.map((sample) => sample.cpu),
    ramValues: series.map((sample) => sample.ramGb),
  }
}
