import { describe, expect, it } from 'bun:test'

import { htmlToMarkdown, htmlToText, titleOf } from '../extract'

const PAGE = [
  '<!doctype html><html><head><title>Atlas v2</title><style>p{}</style></head>',
  '<body><h1>Hello</h1><script>evil()</script><p>First <b>bold</b> line.</p>',
  '<p><a href="/next">Next</a></p></body></html>',
].join('')

describe('htmlToMarkdown', () => {
  it('keeps prose and drops head, style and script', () => {
    const markdown = htmlToMarkdown(PAGE)
    expect(markdown).toContain('# Hello')
    expect(markdown).toContain('First **bold** line.')
    expect(markdown).toContain('[Next](/next)')
    expect(markdown).not.toContain('evil()')
    expect(markdown).not.toContain('p{}')
  })
})

describe('htmlToText', () => {
  it('returns the prose without tags or stripped content', () => {
    const text = htmlToText(PAGE)
    expect(text).toContain('Hello')
    expect(text).toContain('First bold line.')
    expect(text).not.toContain('evil()')
    expect(text).not.toContain('<h1>')
  })
})

describe('titleOf', () => {
  it('reads the title and collapses its whitespace', () => {
    expect(titleOf('<html><head><title>  Atlas\n v2 </title></head></html>')).toBe('Atlas v2')
  })

  it('answers undefined when there is no title', () => {
    expect(titleOf('<html><body><p>no title</p></body></html>')).toBeUndefined()
  })
})
