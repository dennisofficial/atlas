import { describe, expect, it } from 'bun:test'

import {
  clampLevel,
  LEVEL_ATTACK_MS,
  LEVEL_RELEASE_MS,
  levelTimeConstantOf,
  smoothedLevelOf,
} from '../level-smoothing'

describe('clampLevel', () => {
  it('holds a level inside zero and one', () => {
    expect(clampLevel(-0.4)).toBe(0)
    expect(clampLevel(1.4)).toBe(1)
    expect(clampLevel(0.35)).toBe(0.35)
    expect(clampLevel(Number.NaN)).toBe(0)
  })
})

describe('levelTimeConstantOf', () => {
  it('rises faster than it falls', () => {
    expect(levelTimeConstantOf({ previous: 0, target: 1 })).toBe(LEVEL_ATTACK_MS)
    expect(levelTimeConstantOf({ previous: 1, target: 0 })).toBe(LEVEL_RELEASE_MS)
    expect(LEVEL_ATTACK_MS).toBeLessThan(LEVEL_RELEASE_MS)
  })
})

describe('smoothedLevelOf', () => {
  it('returns the previous level before any time passes', () => {
    expect(smoothedLevelOf({ previous: 0, target: 1, elapsedMs: 0 })).toBe(0)
  })

  it('moves toward a louder target quickly', () => {
    const next = smoothedLevelOf({ previous: 0, target: 1, elapsedMs: 45 })
    expect(next).toBeGreaterThan(0.6)
    expect(next).toBeLessThan(1)
  })

  it('falls toward silence slowly', () => {
    const next = smoothedLevelOf({ previous: 1, target: 0, elapsedMs: 45 })
    expect(next).toBeGreaterThan(0.8)
    expect(next).toBeLessThan(1)
  })

  it('does not overshoot the target', () => {
    let level = 0
    for (let frame = 0; frame < 30; frame += 1) {
      level = smoothedLevelOf({ previous: level, target: 0.7, elapsedMs: 16 })
      expect(level).toBeLessThanOrEqual(0.7)
    }
    expect(level).toBeCloseTo(0.7, 2)
  })

  it('stays inside zero and one when the target is out of range', () => {
    expect(smoothedLevelOf({ previous: 0.9, target: 4, elapsedMs: 400 })).toBeLessThanOrEqual(1)
    expect(smoothedLevelOf({ previous: 0.1, target: -3, elapsedMs: 400 })).toBeGreaterThanOrEqual(0)
  })

  it('settles on the target once enough time passes', () => {
    expect(smoothedLevelOf({ previous: 0, target: 0.62, elapsedMs: 1000 })).toBeCloseTo(0.62, 5)
  })
})
