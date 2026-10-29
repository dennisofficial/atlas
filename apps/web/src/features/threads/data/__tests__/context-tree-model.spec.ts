import { describe, expect, it } from 'bun:test'

import { contextIndentOf } from '../context-tree-model'

describe('contextIndentOf', () => {
  it('keeps the first level flush with the other rows', () => {
    expect(contextIndentOf(0)).toBe(0)
  })

  it('adds 12px per nested level', () => {
    expect(contextIndentOf(1)).toBe(12)
    expect(contextIndentOf(3)).toBe(36)
  })

  it('never goes negative', () => {
    expect(contextIndentOf(-1)).toBe(0)
  })
})
