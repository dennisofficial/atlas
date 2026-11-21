import { describe, expect, it } from 'bun:test'

import { podDiskGrowthOf } from '../pod-disk'

const GB = 2 ** 30

const grow = (args: { usedGb: number; limitGb: number; maxGb?: number }) =>
  podDiskGrowthOf({
    usedBytes: args.usedGb * GB,
    limitBytes: args.limitGb * GB,
    maxGb: args.maxGb ?? 100,
  })

describe('podDiskGrowthOf', () => {
  it('leaves a disk below 80 percent alone', () => {
    expect(grow({ usedGb: 15.8, limitGb: 20 })).toBeUndefined()
    expect(grow({ usedGb: 79, limitGb: 100 })).toBeUndefined()
  })

  it('grows at exactly 80 percent', () => {
    expect(grow({ usedGb: 16, limitGb: 20 })).toBe(30)
  })

  it('grows a 64 GB pod by half', () => {
    expect(grow({ usedGb: 52, limitGb: 64 })).toBe(96)
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
    ).toBe(30)
  })

  it('has nothing to say about an unknown volume', () => {
    expect(podDiskGrowthOf({ usedBytes: 0, limitBytes: 0, maxGb: 100 })).toBeUndefined()
  })
})
