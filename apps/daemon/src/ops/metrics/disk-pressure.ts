import { EPodDiskPressure, podDiskPressureOf } from '@dltech/atlas-core'
import type { PodDiskPressureEvent } from '@dltech/atlas-protocol'

export const DISK_PRESSURE_INTERVAL_ENV = 'ATLAS_DISK_PRESSURE_INTERVAL_MS'
export const DISK_PRESSURE_INTERVAL_MS = 15_000
export const DISK_PRESSURE_REPEAT_MS = 60_000

const MIN_INTERVAL_MS = 10

export const diskPressureIntervalOf = (env: Record<string, string | undefined>): number => {
  const asked = Number(env[DISK_PRESSURE_INTERVAL_ENV])
  if (!Number.isFinite(asked) || asked < MIN_INTERVAL_MS) return DISK_PRESSURE_INTERVAL_MS
  return Math.floor(asked)
}

export type DiskPressureState = { pressure: EPodDiskPressure; at: number }

export type DiskPressureDecision = { report: boolean; next: DiskPressureState | undefined }

const rankOf = (pressure: EPodDiskPressure): number => {
  if (pressure === EPodDiskPressure.Urgent) return 2
  if (pressure === EPodDiskPressure.Grow) return 1
  return 0
}

export const diskPressureReportOf = (args: {
  last: DiskPressureState | undefined
  usedBytes: number
  limitBytes: number
  at: number
}): DiskPressureDecision => {
  const pressure = podDiskPressureOf({ usedBytes: args.usedBytes, limitBytes: args.limitBytes })
  if (pressure === EPodDiskPressure.Fine) return { report: false, next: undefined }
  const last = args.last
  const rose = last === undefined || rankOf(pressure) > rankOf(last.pressure)
  const due = last !== undefined && args.at - last.at >= DISK_PRESSURE_REPEAT_MS
  if (!rose && !due) return { report: false, next: last }
  return { report: true, next: { pressure, at: args.at } }
}

export type PodDiskFigures = { usedBytes: number; limitBytes: number }

export type DiskPressureSampler = {
  check(at: number): void
  start(): void
  forget(): void
  stop(): void
}

export const diskPressureSamplerOf = (args: {
  read(): PodDiskFigures | null
  publish(event: PodDiskPressureEvent): void
  intervalMs: number
  now?(): number
}): DiskPressureSampler => {
  let last: DiskPressureState | undefined
  let timer: ReturnType<typeof setInterval> | null = null
  const now = args.now ?? (() => Date.now())

  const check = (at: number): void => {
    const figures = args.read()
    if (figures === null) return
    const decision = diskPressureReportOf({ last, at, ...figures })
    last = decision.next
    if (!decision.report || decision.next === undefined) return
    args.publish({
      type: 'pod.disk-pressure',
      usedBytes: figures.usedBytes,
      limitBytes: figures.limitBytes,
      pressure: decision.next.pressure,
    })
  }

  return {
    check,
    start: () => {
      if (timer !== null) return
      timer = setInterval(() => {
        check(now())
      }, args.intervalMs)
      timer.unref()
    },
    forget: () => {
      last = undefined
    },
    stop: () => {
      if (timer !== null) clearInterval(timer)
      timer = null
      last = undefined
    },
  }
}
