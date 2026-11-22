import { describe, expect, it } from 'bun:test'

import { EPodDiskPressure, podDiskGrowthOf, podDiskPressureOf } from '../pod-disk'

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
  it('leaves a disk below 80 percent alone', () => {
    expect(grow({ usedGb: 15.8, limitGb: 20 })).toBeUndefined()
    expect(grow({ usedGb: 79, limitGb: 100 })).toBeUndefined()
  })

  it('grows at exactly 80 percent', () => {
    expect(grow({ usedGb: 16, limitGb: 20 })).toBe(40)
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
    { name: 'just under 80 percent', usedGb: 79.9, limitGb: 100, level: EPodDiskPressure.Fine },
    { name: 'exactly 80 percent', usedGb: 80, limitGb: 100, level: EPodDiskPressure.Grow },
    { name: '94 percent', usedGb: 94, limitGb: 100, level: EPodDiskPressure.Grow },
    { name: 'exactly 95 percent', usedGb: 95, limitGb: 100, level: EPodDiskPressure.Urgent },
    { name: 'a full disk', usedGb: 100, limitGb: 100, level: EPodDiskPressure.Urgent },
  ])('reads $name as $level', ({ usedGb, limitGb, level }) => {
    expect(pressure({ usedGb, limitGb })).toBe(level)
  })

  it('is urgent when less than 2 GiB is free, however small the disk', () => {
    expect(pressure({ usedGb: 8.5, limitGb: 10 })).toBe(EPodDiskPressure.Urgent)
    expect(pressure({ usedGb: 8.1, limitGb: 10 })).toBe(EPodDiskPressure.Urgent)
    expect(pressure({ usedGb: 7.9, limitGb: 10 })).toBe(EPodDiskPressure.Fine)
    expect(pressure({ usedGb: 8, limitGb: 10 })).toBe(EPodDiskPressure.Grow)
  })

  it('is fine on a volume with no limit to read', () => {
    expect(podDiskPressureOf({ usedBytes: 5 * GB, limitBytes: 0 })).toBe(EPodDiskPressure.Fine)
  })
})
