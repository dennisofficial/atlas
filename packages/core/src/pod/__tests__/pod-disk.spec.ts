import { describe, expect, it } from 'bun:test'

import {
  EPodDiskCeilingAction,
  EPodDiskPressure,
  POD_DISK_CEILING_NUDGE_LEVELS,
  POD_DISK_CEILING_REARM_BELOW,
  podDiskCeilingNudgeOf,
  podDiskGrowthOf,
  podDiskPressureOf,
} from '../pod-disk'

const GB = 2 ** 30

const grow = (args: { usedGb: number; limitGb: number; maxGb?: number }) =>
  podDiskGrowthOf({
    usedBytes: args.usedGb * GB,
    limitBytes: args.limitGb * GB,
    maxGb: args.maxGb ?? 100,
  })

const pressure = (args: { usedGb: number; limitGb: number }) =>
  podDiskPressureOf({ usedBytes: args.usedGb * GB, limitBytes: args.limitGb * GB })

describe('podDiskGrowthOf', () => {
  it('leaves a disk below 70 percent alone', () => {
    expect(grow({ usedGb: 13.9, limitGb: 20 })).toBeUndefined()
    expect(grow({ usedGb: 69, limitGb: 100 })).toBeUndefined()
  })

  it('grows at exactly 70 percent', () => {
    expect(grow({ usedGb: 14, limitGb: 20 })).toBe(40)
  })

  it('doubles a 64 GB pod up to the ceiling', () => {
    expect(grow({ usedGb: 52, limitGb: 64 })).toBe(100)
    expect(grow({ usedGb: 52, limitGb: 40 })).toBe(80)
  })

  it('stops at the cap', () => {
    expect(grow({ usedGb: 64, limitGb: 80 })).toBe(100)
  })

  it('leaves a disk already at the biggest size alone', () => {
    expect(grow({ usedGb: 90, limitGb: 100 })).toBeUndefined()
  })

  it('reads the ceiling off the volume rather than a rounded megabyte count', () => {
    expect(
      podDiskGrowthOf({ usedBytes: 20_000_000_000, limitBytes: 21_474_836_480, maxGb: 100 }),
    ).toBe(40)
  })

  it('doubles the size the provider bills, not the smaller size the filesystem reports', () => {
    expect(
      podDiskGrowthOf({ usedBytes: 34 * GB, limitBytes: 42_091_216_896, maxGb: 100, sizeGb: 40 }),
    ).toBe(80)
  })

  it('has nothing to say about an unknown volume', () => {
    expect(podDiskGrowthOf({ usedBytes: 0, limitBytes: 0, maxGb: 100 })).toBeUndefined()
  })
})

describe('podDiskPressureOf', () => {
  it.each([
    { name: 'an empty disk', usedGb: 0, limitGb: 100, level: EPodDiskPressure.Fine },
    { name: 'just under 70 percent', usedGb: 69, limitGb: 100, level: EPodDiskPressure.Fine },
    { name: 'exactly 70 percent', usedGb: 70, limitGb: 100, level: EPodDiskPressure.Grow },
    { name: '84 percent with 16 GB free', usedGb: 84, limitGb: 100, level: EPodDiskPressure.Grow },
    {
      name: '86 percent with 14 GB free',
      usedGb: 86,
      limitGb: 100,
      level: EPodDiskPressure.Urgent,
    },
    { name: 'exactly 90 percent', usedGb: 90, limitGb: 100, level: EPodDiskPressure.Urgent },
    { name: 'a full disk', usedGb: 100, limitGb: 100, level: EPodDiskPressure.Urgent },
    { name: '13 GB of 20', usedGb: 13, limitGb: 20, level: EPodDiskPressure.Fine },
    { name: '14.5 GB of 20', usedGb: 14.5, limitGb: 20, level: EPodDiskPressure.Grow },
    { name: '17.5 GB of 20', usedGb: 17.5, limitGb: 20, level: EPodDiskPressure.Urgent },
  ])('reads $name as $level', ({ usedGb, limitGb, level }) => {
    expect(pressure({ usedGb, limitGb })).toBe(level)
  })

  it('is urgent when free space falls under 15 percent, with a 2 GiB floor', () => {
    expect(pressure({ usedGb: 34.5, limitGb: 40 })).toBe(EPodDiskPressure.Urgent)
    expect(pressure({ usedGb: 34, limitGb: 40 })).toBe(EPodDiskPressure.Grow)
    expect(pressure({ usedGb: 8.5, limitGb: 10 })).toBe(EPodDiskPressure.Urgent)
    expect(pressure({ usedGb: 8.1, limitGb: 10 })).toBe(EPodDiskPressure.Urgent)
    expect(pressure({ usedGb: 8, limitGb: 10 })).toBe(EPodDiskPressure.Grow)
  })

  it('is fine on a volume with no limit to read', () => {
    expect(podDiskPressureOf({ usedBytes: 5 * GB, limitBytes: 0 })).toBe(EPodDiskPressure.Fine)
  })
})

describe('podDiskCeilingNudgeOf', () => {
  it.each([
    {
      name: 'a disk with no limit',
      usedGb: 10,
      limitGb: 0,
      nudged: undefined,
      action: EPodDiskCeilingAction.None,
    },
    {
      name: '84 percent',
      usedGb: 84,
      limitGb: 100,
      nudged: undefined,
      action: EPodDiskCeilingAction.None,
    },
    {
      name: '85 percent',
      usedGb: 85,
      limitGb: 100,
      nudged: undefined,
      action: EPodDiskCeilingAction.Nudge,
      percent: 85,
    },
    {
      name: '85 percent already nudged',
      usedGb: 86,
      limitGb: 100,
      nudged: 85,
      action: EPodDiskCeilingAction.None,
    },
    {
      name: '94 percent',
      usedGb: 94,
      limitGb: 100,
      nudged: 85,
      action: EPodDiskCeilingAction.None,
    },
    {
      name: '95 percent after the 85 percent nudge',
      usedGb: 95,
      limitGb: 100,
      nudged: 85,
      action: EPodDiskCeilingAction.Nudge,
      percent: 95,
    },
    {
      name: 'a full disk already nudged twice',
      usedGb: 100,
      limitGb: 100,
      nudged: 95,
      action: EPodDiskCeilingAction.None,
    },
    {
      name: '80 percent after the 85 percent nudge',
      usedGb: 80,
      limitGb: 100,
      nudged: 85,
      action: EPodDiskCeilingAction.None,
    },
    {
      name: '79 percent after the 85 percent nudge',
      usedGb: 79,
      limitGb: 100,
      nudged: 85,
      action: EPodDiskCeilingAction.Rearm,
    },
    {
      name: '79 percent with nothing nudged',
      usedGb: 79,
      limitGb: 100,
      nudged: undefined,
      action: EPodDiskCeilingAction.None,
    },
    {
      name: '85 percent of a 20 GB volume',
      usedGb: 17,
      limitGb: 20,
      nudged: undefined,
      action: EPodDiskCeilingAction.Nudge,
      percent: 85,
    },
  ])('reads $name as $action', ({ usedGb, limitGb, nudged, action, percent }) => {
    expect(
      podDiskCeilingNudgeOf({
        usedBytes: usedGb * GB,
        limitBytes: limitGb * GB,
        nudgedPercent: nudged,
      }),
    ).toEqual({ action, ...(percent === undefined ? {} : { percent }) })
  })

  it('names its levels and re-arm threshold', () => {
    expect(POD_DISK_CEILING_NUDGE_LEVELS).toEqual([85, 95])
    expect(POD_DISK_CEILING_REARM_BELOW).toBe(80)
  })
})
