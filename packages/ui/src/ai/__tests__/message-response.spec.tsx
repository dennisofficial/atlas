import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MessageResponse } from '../message-response'
import { codeTextOf, languageOf } from '../internal/markdown-code'

const render = (markdown: string) =>
  renderToStaticMarkup(<MessageResponse mode="static">{markdown}</MessageResponse>)

describe('MessageResponse', () => {
  it('renders a heading', () => {
    expect(render('## Title')).toContain('<h2')
  })

  it('renders a table through our table parts', () => {
    const html = render('| a | b |\n| - | - |\n| 1 | 2 |')

    expect(html).toContain('data-slot="table"')
    expect(html).toContain('data-slot="table-head"')
    expect(html).toContain('data-slot="table-cell"')
  })

  it('renders a ts fence through our code block', () => {
    const html = render('```ts\nconst a = 1\n```')

    expect(html).toContain('data-slot="code-block"')
    expect(html).toContain('const a = 1')
    expect(html).toContain('>ts<')
  })

  it('renders inline code without a code block', () => {
    const html = render('Use `bun test` here')

    expect(html).toContain('data-slot="inline-code"')
    expect(html).not.toContain('data-slot="code-block"')
  })

  it('hands a mermaid fence back to streamdown instead of our code block', () => {
    const html = render('```mermaid\nflowchart LR\n  A --> B\n```')

    expect(html).not.toContain('data-slot="code-block"')
  })

  it('spends the accent on h2 and inline code, as the TUI does', () => {
    expect(render('## Title')).toMatch(/<h2[^>]*text-primary/)
    expect(render('Use `bun test` here')).toMatch(/<code[^>]*text-primary/)
  })

  it('colors links with the link token, not the accent', () => {
    const html = render('[docs](https://example.com)')

    expect(html).toContain('text-link')
    expect(html).not.toMatch(/<a[^>]*text-primary/)
  })

  it('opens links in a new tab', () => {
    const html = render('[docs](https://example.com)')

    expect(html).toContain('target="_blank"')
    expect(html).toContain('noreferrer')
  })

  it('renders a rule through our separator', () => {
    expect(render('a\n\n---\n\nb')).toContain('data-slot="separator"')
  })
})

describe('MessageResponse treats html as text', () => {
  it('keeps everything after an unclosed html comment', () => {
    const html = render('marker:\n\n<!-- codex-state: abc\n\n## After\n\ntail text')

    expect(html).toContain('&lt;!-- codex-state: abc')
    expect(html).toContain('<h2')
    expect(html).toContain('tail text')
  })

  it('shows a closed html comment as text', () => {
    expect(render('<!-- hidden -->\n\nafter')).toContain('&lt;!-- hidden --&gt;')
  })

  it('shows inline html tags as text', () => {
    expect(render('a <b>bold</b> word')).toContain('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('still renders markdown around the html', () => {
    expect(render('**strong** <i>x</i>')).toContain('data-streamdown="strong"')
  })
})

describe('markdown code helpers', () => {
  it('reads the language from the class', () => {
    expect(languageOf('language-ts')).toBe('ts')
    expect(languageOf(undefined)).toBe('')
  })

  it('reads the source from string or element children', () => {
    expect(codeTextOf('x')).toBe('x')
    expect(codeTextOf(<span>y</span>)).toBe('y')
    expect(codeTextOf(null)).toBe('')
  })
})
