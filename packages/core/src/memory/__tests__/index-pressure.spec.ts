import { describe, expect, it } from 'bun:test'

import {
  descriptionBudgetRefusal,
  EIndexPressure,
  indexPressureOf,
  MEMORY_INDEX_ADVISORY_CHARS,
  MEMORY_INDEX_DESCRIPTION_CHARS,
  MEMORY_INDEX_RECONCILE_CHARS,
} from '../index-pressure'

describe('indexPressureOf', () => {
  it.each([
    [0, EIndexPressure.Clear],
    [MEMORY_INDEX_ADVISORY_CHARS - 1, EIndexPressure.Clear],
    [MEMORY_INDEX_ADVISORY_CHARS, EIndexPressure.Advisory],
    [MEMORY_INDEX_RECONCILE_CHARS - 1, EIndexPressure.Advisory],
    [MEMORY_INDEX_RECONCILE_CHARS, EIndexPressure.Reconcile],
  ])('reads %i characters as level %i', (chars, pressure) => {
    expect(indexPressureOf(chars)).toBe(pressure)
  })
})

describe('descriptionBudgetRefusal', () => {
  it('accepts a description at the budget', () => {
    expect(descriptionBudgetRefusal('d'.repeat(MEMORY_INDEX_DESCRIPTION_CHARS))).toBeUndefined()
  })

  it('refuses a longer one and says how to fix it', () => {
    const reason = descriptionBudgetRefusal('d'.repeat(MEMORY_INDEX_DESCRIPTION_CHARS + 1))
    expect(reason).toContain('has 201 characters. The limit is 200 characters')
    expect(reason).toContain('Move the reason and the details into the body.')
  })
})
