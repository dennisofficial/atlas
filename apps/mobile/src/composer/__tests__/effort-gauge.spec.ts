import { describe, expect, it } from 'bun:test'

import { effortArcPath, effortFractionOf, effortNeedleDegrees } from '../effort-gauge-model'

const EFFORTS = ['low', 'medium', 'high']

describe('effortFractionOf', () => {
  it('places the first rung at 0 and the last at 1', () => {
    expect(effortFractionOf({ efforts: EFFORTS, effort: 'low' })).toBe(0)
    expect(effortFractionOf({ efforts: EFFORTS, effort: 'high' })).toBe(1)
  })

  it('places a middle rung evenly between them', () => {
    expect(effortFractionOf({ efforts: EFFORTS, effort: 'medium' })).toBe(0.5)
  })

  it('treats a single rung as full', () => {
    expect(effortFractionOf({ efforts: ['medium'], effort: 'medium' })).toBe(1)
  })

  it('falls back to empty for an unknown effort', () => {
    expect(effortFractionOf({ efforts: EFFORTS, effort: 'max' })).toBe(0)
  })
})

describe('effortNeedleDegrees', () => {
  it('points left at the bottom rung and right at the top', () => {
    expect(effortNeedleDegrees({ fraction: 0 })).toBe(-135)
    expect(effortNeedleDegrees({ fraction: 1 })).toBe(135)
    expect(effortNeedleDegrees({ fraction: 0.5 })).toBe(0)
  })
})

describe('effortArcPath', () => {
  it('draws the whole dial, open at the bottom', () => {
    expect(effortArcPath({ fraction: 1 })).toBe('M 5.64 18.36 A 9 9 0 1 1 18.36 18.36')
  })

  it('draws a quarter of the sweep for a quarter turn', () => {
    expect(effortArcPath({ fraction: 0.25 })).toBe('M 5.64 18.36 A 9 9 0 0 1 3.69 8.56')
  })
})
