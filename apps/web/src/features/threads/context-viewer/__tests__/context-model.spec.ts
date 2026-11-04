import { describe, expect, it } from 'bun:test'

import { copyTextOf, ERenderKind, isMarkdownPath, renderKindOf } from '../context-model'

describe('isMarkdownPath', () => {
  it('matches markdown extensions only', () => {
    expect(isMarkdownPath('plans/a.md')).toBe(true)
    expect(isMarkdownPath('A.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('notes.txt')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
  })
})

describe('renderKindOf', () => {
  it('renders markdown and html, leaves everything else as source', () => {
    expect(renderKindOf('packages/db/AGENTS.md')).toBe(ERenderKind.Markdown)
    expect(renderKindOf('docs/page.mdx')).toBe(ERenderKind.Markdown)
    expect(renderKindOf('site/index.html')).toBe(ERenderKind.Html)
    expect(renderKindOf('OLD.HTM')).toBe(ERenderKind.Html)
    expect(renderKindOf('src/client.ts')).toBeNull()
    expect(renderKindOf('page.html.ts')).toBeNull()
  })
})

describe('copyTextOf', () => {
  it('copies text content only', () => {
    expect(copyTextOf({ type: 'text', content: 'hi', truncated: false })).toBe('hi')
    expect(copyTextOf({ type: 'refused', reason: 'big' })).toBeNull()
    expect(copyTextOf({ type: 'image', data: '', mediaType: 'image/png' })).toBeNull()
  })
})
