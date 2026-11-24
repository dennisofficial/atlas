import { space } from '@dltech/atlas-ui/tokens'
import { describe, expect, test } from 'bun:test'

import { listItemIndent, listTextLayout } from '../markdown/layout'

describe('listTextLayout', () => {
  test('measures the item text by its own content instead of a zero basis', () => {
    expect(listTextLayout).toEqual({ flexBasis: 'auto', flexGrow: 1, flexShrink: 1 })
  })

  test('shrinks and grows so both a hugging bubble and a full-width transcript fit', () => {
    expect(listTextLayout.flexShrink).toBe(1)
    expect(listTextLayout.flexGrow).toBe(1)
    expect(listTextLayout.flexBasis).not.toBe(0)
  })
})

describe('listItemIndent', () => {
  test('indents each nesting level by one step', () => {
    expect(listItemIndent({ depth: 0 })).toBe(0)
    expect(listItemIndent({ depth: 1 })).toBe(space(2))
    expect(listItemIndent({ depth: 3 })).toBe(space(2) * 3)
  })
})
