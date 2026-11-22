import { describe, expect, it } from 'bun:test'

import { EPodDiskPressure } from '@dltech/atlas-core'
import type { PodDiskPressureEvent } from '@dltech/atlas-protocol'

import {
  DISK_PRESSURE_INTERVAL_ENV,
  DISK_PRESSURE_INTERVAL_MS,
  DISK_PRESSURE_REPEAT_MS,
  diskPressureIntervalOf,
  diskPressureReportOf,
  diskPressureSamplerOf,
  type PodDiskFigures,
} from '../disk-pressure'

const GB = 2 ** 30

const figuresOf = (args: { usedGb: number; limitGb: number }): PodDiskFigures => ({
  usedBytes: args.usedGb * GB,
  limitBytes: args.limitGb * GB,
})

describe('diskPressureReportOf', () => {
  it('says nothing about a disk under the grow line', () => {
    expect(
      diskPressureReportOf({ last: undefined, at: 1, ...figuresOf({ usedGb: 10, limitGb: 20 }) }),
    ).toEqual({ report: false, next: undefined })
  })

  it('reports the first reading at grow level', () => {
    expect(
      diskPressureReportOf({ last: undefined, at: 1, ...figuresOf({ usedGb: 17, limitGb: 20 }) }),
    ).toEqual({ report: true, next: { pressure: EPodDiskPressure.Grow, at: 1 } })
  })

  it('reports the rise from grow to urgent at once', () => {
    const grown = diskPressureReportOf({
      last: undefined,
      at: 1,
      ...figuresOf({ usedGb: 17, limitGb: 20 }),
    })
    expect(
      diskPressureReportOf({
        last: grown.next,
        at: 2,
        ...figuresOf({ usedGb: 19.5, limitGb: 20 }),
      }),
    ).toEqual({ report: true, next: { pressure: EPodDiskPressure.Urgent, at: 2 } })
  })

  it('repeats while the level stands, once the repeat window has passed', () => {
    const grown = diskPressureReportOf({
      last: undefined,
      at: 1,
      ...figuresOf({ usedGb: 17, limitGb: 20 }),
    })
    const figures = figuresOf({ usedGb: 17, limitGb: 20 })
    expect(diskPressureReportOf({ last: grown.next, at: 1 + 5_000, ...figures })).toEqual({
      report: false,
      next: { pressure: EPodDiskPressure.Grow, at: 1 },
    })
    expect(
      diskPressureReportOf({ last: grown.next, at: 1 + DISK_PRESSURE_REPEAT_MS, ...figures }),
    ).toEqual({ report: true, next: { pressure: EPodDiskPressure.Grow, at: 1 + 60_000 } })
  })

  it('forgets the level once the disk falls back under the grow line', () => {
    const grown = diskPressureReportOf({
      last: undefined,
      at: 1,
      ...figuresOf({ usedGb: 17, limitGb: 20 }),
    })
    const fine = diskPressureReportOf({
      last: grown.next,
      at: 2,
      ...figuresOf({ usedGb: 4, limitGb: 40 }),
    })
    expect(fine).toEqual({ report: false, next: undefined })
    expect(
      diskPressureReportOf({ last: fine.next, at: 3, ...figuresOf({ usedGb: 17, limitGb: 20 }) }),
    ).toEqual({ report: true, next: { pressure: EPodDiskPressure.Grow, at: 3 } })
  })
})

describe('diskPressureSamplerOf', () => {
  it('publishes the figures it read, and nothing while the level stands', () => {
    const events: PodDiskPressureEvent[] = []
    let figures = figuresOf({ usedGb: 17, limitGb: 20 })
    const sampler = diskPressureSamplerOf({
      read: () => figures,
      publish: (event) => events.push(event),
      intervalMs: 10,
    })
    sampler.check(1)
    sampler.check(2)
    expect(events).toEqual([
      {
        type: 'pod.disk-pressure',
        usedBytes: 17 * GB,
        limitBytes: 20 * GB,
        pressure: EPodDiskPressure.Grow,
      },
    ])
    figures = figuresOf({ usedGb: 19.5, limitGb: 20 })
    sampler.check(3)
    expect(events.map((event) => event.pressure)).toEqual([
      EPodDiskPressure.Grow,
      EPodDiskPressure.Urgent,
    ])
    sampler.stop()
  })

  it('says nothing when the pod has no disk figures', () => {
    const events: PodDiskPressureEvent[] = []
    const sampler = diskPressureSamplerOf({
      read: () => null,
      publish: (event) => events.push(event),
      intervalMs: 10,
    })
    sampler.check(1)
    expect(events).toEqual([])
    sampler.stop()
  })

  it('samples on its own timer, with no metrics subscriber', async () => {
    const events: PodDiskPressureEvent[] = []
    const sampler = diskPressureSamplerOf({
      read: () => figuresOf({ usedGb: 17, limitGb: 20 }),
      publish: (event) => events.push(event),
      intervalMs: 10,
    })
    sampler.start()
    const deadline = Date.now() + 2_000
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    sampler.stop()
    expect(events).toHaveLength(1)
  })

  it('reads the sampling interval off the environment', () => {
    expect(diskPressureIntervalOf({})).toBe(DISK_PRESSURE_INTERVAL_MS)
    expect(diskPressureIntervalOf({ [DISK_PRESSURE_INTERVAL_ENV]: '250' })).toBe(250)
    expect(diskPressureIntervalOf({ [DISK_PRESSURE_INTERVAL_ENV]: '0' })).toBe(
      DISK_PRESSURE_INTERVAL_MS,
    )
  })
})
