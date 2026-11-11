import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MessageResponse } from '../message-response'

const SANDBOX_REPLY = await Bun.file(
  new URL('./fixtures/markdown-render-test.md', import.meta.url),
).text()

const render = (markdown: string, isAnimating = false) =>
  renderToStaticMarkup(<MessageResponse isAnimating={isAnimating}>{markdown}</MessageResponse>)

const textOf = (html: string) => html.replace(/<[^>]+>/g, '')

describe('MessageResponse on a real model reply', () => {
  it('adds nothing after the last paragraph', () => {
    for (const isAnimating of [false, true]) {
      const html = render(SANDBOX_REPLY, isAnimating)
      const afterLastParagraph = html.slice(html.indexOf('test case for it.'))

      expect(html.split('data-slot="separator"').length - 1).toBe(3)
      expect(afterLastParagraph).not.toContain('data-slot="separator"')
      expect(textOf(afterLastParagraph)).not.toContain('*')
    }
  })

  it('keeps a *** rule while streaming text after it', () => {
    const html = render('***\nHidden content with **formatting** and a list:', true)

    expect(html).toContain('data-slot="separator"')
    expect(textOf(html)).not.toContain('**')
  })

  it('renders double-dollar inline and block math with KaTeX', () => {
    const html = render('Inline: $$E = mc^2$$. Block:\n\n$$\n\\sum_{i=1}^{n} i\n$$')

    expect(html.split('class="katex"').length - 1).toBe(2)
  })

  it('keeps a dollar amount as money rather than math', () => {
    for (const isAnimating of [false, true]) {
      const html = render(
        '1 high and 4 mediums for $21.94, ten times the surface coverage of the control. Kimi cost $54.80 to produce 26 items.',
        isAnimating,
      )

      expect(html).not.toContain('katex')
      expect(textOf(html)).toContain('for $21.94, ten times the surface coverage of the control.')
      expect(textOf(html)).toContain('cost $54.80')
    }
  })

  it('joins single newlines by default and breaks them when asked', () => {
    const source = 'First line\nSecond line\n\nNew paragraph'
    const joined = render(source)
    const broken = renderToStaticMarkup(<MessageResponse breaks>{source}</MessageResponse>)

    expect(joined).not.toContain('<br')
    expect(broken.split('<br').length - 1).toBe(1)
    expect(broken.split('<p').length - 1).toBe(2)
  })

  it('turns emoji shortcodes into emoji', () => {
    expect(render('Shortcode :rocket: here')).toContain('Shortcode 🚀 here')
  })

  it('renders GitHub alerts as a titled note without the marker', () => {
    const html = render('> [!WARNING]\n> A warning admonition.')

    expect(html).toContain('data-alert="warning"')
    expect(html).toContain('Warning')
    expect(html).toContain('A warning admonition.')
    expect(html).not.toContain('[!WARNING]')
  })

  it('leaves a plain blockquote alone', () => {
    const html = render('> Just a quote.')

    expect(html).toContain('<blockquote')
    expect(html).not.toContain('data-alert')
  })

  it('draws task items with our checkbox and no bullet', () => {
    const html = render('- [x] Render headings\n- [ ] Render footnotes')

    expect(html).toContain('data-slot="checkbox"')
    expect(html).not.toContain('<input type="checkbox" disabled')
    expect(html).toContain('list-none')
  })

  it('keeps footnote links in the page instead of a new tab', () => {
    const html = render('A note.[^1]\n\n[^1]: The first footnote.')
    const inPageLinks = html.match(/<a [^>]*href="#[^"]*"[^>]*>/g) ?? []

    expect(inPageLinks.length).toBe(2)
    for (const link of inPageLinks) expect(link).not.toContain('target="_blank"')
  })
})
