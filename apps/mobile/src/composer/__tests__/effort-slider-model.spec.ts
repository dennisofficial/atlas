import { describe, expect, it } from 'bun:test'

import { effortAtIndex, effortIndexIn, effortSliderMaxOf } from '../effort-slider-model'

const EFFORTS = ['low', 'medium', 'high', 'max'] as const

describe('effortIndexIn', () => {
  it('maps an effort to its rung', () => {
    expect(effortIndexIn({ efforts: EFFORTS, effort: 'high' })).toBe(2)
  })

  it('falls back to the first rung for an effort the model does not offer', () => {
    expect(effortIndexIn({ efforts: EFFORTS, effort: 'xhigh' })).toBe(0)
  })

  it('returns zero for an empty ladder', () => {
    expect(effortIndexIn({ efforts: [], effort: 'medium' })).toBe(0)
  })
})

describe('effortAtIndex', () => {
  it('maps a slider step to its effort', () => {
    expect(effortAtIndex({ efforts: EFFORTS, index: 1 })).toBe('medium')
  })

  it('rounds a fractional step', () => {
    expect(effortAtIndex({ efforts: EFFORTS, index: 2.6 })).toBe('max')
  })

  it('clamps a step below the ladder and above it', () => {
    expect(effortAtIndex({ efforts: EFFORTS, index: -3 })).toBe('low')
    expect(effortAtIndex({ efforts: EFFORTS, index: 9 })).toBe('max')
  })

  it('returns null for an empty ladder', () => {
    expect(effortAtIndex({ efforts: [], index: 2 })).toBeNull()
  })
})

describe('effortSliderMaxOf', () => {
  it('is the last rung index', () => {
    expect(effortSliderMaxOf(EFFORTS)).toBe(3)
  })

  it('is zero for a ladder with a single rung or none', () => {
    expect(effortSliderMaxOf(['medium'])).toBe(0)
    expect(effortSliderMaxOf([])).toBe(0)
  })
})
