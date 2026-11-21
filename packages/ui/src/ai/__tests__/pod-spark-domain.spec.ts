import { describe, expect, it } from 'bun:test'

import {
  POD_SERIES_WINDOW_MS,
  podSparkDomainOf,
  podSparkNearest,
  podSparkTimeAt,
  podSparkTipOf,
  podSparkWindowOf,
} from '../internal/pod-spark-domain'

describe('podSparkDomainOf', () => {
  it('zooms into idle noise instead of pinning it to the bottom of a 0-100 axis', () => {
    expect(podSparkDomainOf([3, 8, 15, 20, 22])).toEqual([2, 23])
  })

  it('keeps a quiet series from filling the height', () => {
    expect(podSparkDomainOf([8])).toEqual([2, 14])
  })

  it('never leaves the percentage axis', () => {
    expect(podSparkDomainOf([99, 100])).toEqual([94, 100])
    expect(podSparkDomainOf([0, 1])).toEqual([0, 6])
  })

  it('falls back to the whole axis with nothing to draw', () => {
    expect(podSparkDomainOf([])).toEqual([0, 100])
    expect(podSparkDomainOf([Number.NaN])).toEqual([0, 100])
  })
})

describe('podSparkWindowOf', () => {
  it('covers the daemon ring, 300 samples at 3 s', () => {
    expect(POD_SERIES_WINDOW_MS).toBe(300 * 3_000)
    expect(POD_SERIES_WINDOW_MS).toBe(900_000)
  })

  it('ends at the newest sample so a fresh pod grows in from the right', () => {
    expect(podSparkWindowOf({ samples: [{ at: 20_000 }, { at: 1_000_000 }] })).toEqual([
      100_000, 1_000_000,
    ])
  })

  it('keeps a full window with no samples', () => {
    expect(podSparkWindowOf({ samples: [] })).toEqual([-900_000, 0])
  })
})

describe('podSparkTimeAt', () => {
  const from = 1_000
  const to = 901_000

  it('maps the width onto the window', () => {
    expect(podSparkTimeAt({ x: 0, width: 100, from, to })).toBe(1_000)
    expect(podSparkTimeAt({ x: 50, width: 100, from, to })).toBe(451_000)
    expect(podSparkTimeAt({ x: 100, width: 100, from, to })).toBe(901_000)
  })

  it('clamps a pointer that runs past either edge', () => {
    expect(podSparkTimeAt({ x: -20, width: 100, from, to })).toBe(1_000)
    expect(podSparkTimeAt({ x: 400, width: 100, from, to })).toBe(901_000)
  })

  it('reads the window end before a layout', () => {
    expect(podSparkTimeAt({ x: 10, width: 0, from, to })).toBe(901_000)
  })
})

describe('podSparkNearest', () => {
  const samples = [{ at: 0 }, { at: 3_000 }, { at: 6_000 }]

  it('picks the sample closest to the pointer', () => {
    expect(podSparkNearest({ samples, at: 4_100 })).toBe(1)
    expect(podSparkNearest({ samples, at: 5_900 })).toBe(2)
  })

  it('holds the ends when the pointer sits in the blank part of the window', () => {
    expect(podSparkNearest({ samples, at: -800_000 })).toBe(0)
  })

  it('has nothing to pick from an empty series', () => {
    expect(podSparkNearest({ samples: [], at: 0 })).toBeNull()
  })
})

describe('podSparkTipOf', () => {
  it('reads like the legend, with the local time of the sample', () => {
    const at = new Date(2026, 10, 21, 14, 32, 7).getTime()
    expect(podSparkTipOf({ at, cpu: 41.6, usedGb: 1.72, limitGb: 8 })).toEqual({
      time: '14:32:07',
      cpu: '42%',
      ram: '1.7 / 8 GB',
    })
  })
})
