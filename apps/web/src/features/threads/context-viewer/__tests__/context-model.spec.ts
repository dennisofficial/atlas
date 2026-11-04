import { describe, expect, it } from 'bun:test'

import { copyTextOf, isHtmlPath, isMarkdownPath, renderableHtmlOf } from '../context-model'

describe('isHtmlPath', () => {
  it('matches html extensions only', () => {
    expect(isHtmlPath('artifacts/pr-794-deck.html')).toBe(true)
    expect(isHtmlPath('INDEX.HTM')).toBe(true)
    expect(isHtmlPath('notes.md')).toBe(false)
    expect(isHtmlPath('page.html.txt')).toBe(false)
  })
})

describe('renderableHtmlOf', () => {
  it('returns the content of a text file at an html path', () => {
    const file = { type: 'text' as const, content: '<p>hi</p>', truncated: false }
    expect(renderableHtmlOf({ file, path: 'a.html' })).toBe('<p>hi</p>')
    expect(renderableHtmlOf({ file, path: 'a.md' })).toBeNull()
    expect(
      renderableHtmlOf({ file: { type: 'refused', reason: 'big' }, path: 'a.html' }),
    ).toBeNull()
  })
})

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
