import { describe, expect, test } from 'bun:test'

import { EEffort } from '@dltech/atlas-core'

import { effortOf, footerContextOf, footerLayoutOf } from '../footer-model'

describe('the footer model', () => {
  test('names a rung from the row and falls back to medium', () => {
    expect(effortOf('high')).toBe(EEffort.High)
    expect(effortOf('nope')).toBe(EEffort.Medium)
  })

  test('a null reading draws an unmeasured context', () => {
    expect(footerContextOf(null)).toEqual({ percent: null })
  })

  test('a measured reading draws a percentage', () => {
    const context = footerContextOf({ used: 50_000, limit: 200_000, breakdown: [] })
    expect(context.percent).toBe(25)
    expect(context.tokensUsed).toBe(50_000)
  })

  test('lays the facts and the context into one row when they fit', () => {
    const layout = footerLayoutOf({
      width: 100,
      model: 'Claude Sonnet 4.5',
      effort: EEffort.High,
      fast: false,
      items: [],
      context: { percent: 25 },
    })
    expect(layout.instruments.model).toBe('Claude Sonnet 4.5')
    expect(layout.instruments.rows).toBe(1)
  })
})
