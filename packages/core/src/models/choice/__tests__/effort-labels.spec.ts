import { describe, expect, it } from 'bun:test'

import { EEffort } from '../../effort-ladder'
import { EFFORT_RUNG_LABEL, effortLabelOf, effortLabelsOf } from '../effort-labels'

const DEEPSEEK = {
  [EEffort.Off]: 'none',
  [EEffort.Low]: 'low',
  [EEffort.High]: 'high',
  [EEffort.Max]: 'max',
}

describe('effort labels', () => {
  it('reads a wire word back in the model\u2019s own words', () => {
    expect(effortLabelOf({ map: DEEPSEEK, rung: EEffort.Off })).toBe('None')
    expect(effortLabelOf({ map: DEEPSEEK, rung: EEffort.Low })).toBe('Low')
    expect(effortLabelOf({ map: DEEPSEEK, rung: EEffort.High })).toBe('High')
    expect(effortLabelOf({ map: DEEPSEEK, rung: EEffort.Max })).toBe('Max')
  })

  it('shows a budget beside the rung it stands for', () => {
    const budget = { [EEffort.High]: 16_000, [EEffort.Low]: 800 }

    expect(effortLabelOf({ map: budget, rung: EEffort.High })).toBe('High · 16k tokens')
    expect(effortLabelOf({ map: budget, rung: EEffort.Low })).toBe('Low · 800 tokens')
  })

  it('falls back to the rung label when the model has no word for that rung', () => {
    expect(effortLabelOf({ map: DEEPSEEK, rung: EEffort.Medium })).toBe('Medium')
    expect(effortLabelOf({ map: undefined, rung: EEffort.XHigh })).toBe('Extra high')
    expect(EFFORT_RUNG_LABEL[EEffort.XHigh]).toBe('Extra high')
  })

  it('labels only the rungs the model offers', () => {
    expect(effortLabelsOf(DEEPSEEK)).toEqual({
      [EEffort.Off]: 'None',
      [EEffort.Low]: 'Low',
      [EEffort.High]: 'High',
      [EEffort.Max]: 'Max',
    })
    expect(effortLabelsOf(undefined)).toEqual({})
  })
})
