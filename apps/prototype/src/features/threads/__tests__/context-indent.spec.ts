import { describe, expect, it } from 'bun:test'

import { contextIndentOf } from '../details/details-model'

describe('contextIndentOf', () => {
  it('is flush at the root and 12px per level', () => {
    expect(contextIndentOf(0)).toBe(0)
    expect(contextIndentOf(2)).toBe(24)
    expect(contextIndentOf(-1)).toBe(0)
  })
})
