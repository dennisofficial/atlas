import { describe, expect, it } from 'bun:test'

import { copyTextOf, isMarkdownPath } from '../context-model'

describe('isMarkdownPath', () => {
  it('matches markdown extensions only', () => {
    expect(isMarkdownPath('plans/a.md')).toBe(true)
    expect(isMarkdownPath('A.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('notes.txt')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
  })
})

describe('copyTextOf', () => {
  it('copies text content only', () => {
    expect(copyTextOf({ type: 'text', content: 'hi', truncated: false })).toBe('hi')
    expect(copyTextOf({ type: 'refused', reason: 'big' })).toBeNull()
    expect(copyTextOf({ type: 'image', data: '', mediaType: 'image/png' })).toBeNull()
  })
})
