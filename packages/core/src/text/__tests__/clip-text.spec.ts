import { describe, expect, it } from 'bun:test'

import { clipText } from '../clip-text'

describe('clipText', () => {
  it('keeps text at or under the limit as it is', () => {
    expect(clipText({ text: 'abcde', limit: 5 })).toBe('abcde')
    expect(clipText({ text: 'abc', limit: 5 })).toBe('abc')
  })

  it('cuts longer text so the ellipsis lands on the limit', () => {
    expect(clipText({ text: 'abcdef', limit: 5 })).toBe('abcd…')
  })

  it('leaves empty text empty', () => {
    expect(clipText({ text: '', limit: 5 })).toBe('')
  })
})
