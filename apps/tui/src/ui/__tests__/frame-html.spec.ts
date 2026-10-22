import { describe, expect, it } from 'bun:test'

import { TextAttributes } from '@opentui/core'

import { escapeHtml, frameToHtml, type FrameForHtml } from '../frame-html'

const rgba = (r: number, g: number, b: number, a: number) => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a,
})

const frame = (text: string, attributes = TextAttributes.NONE): FrameForHtml => ({
  cols: 40,
  rows: 1,
  lines: [
    {
      spans: [
        {
          text,
          fg: rgba(200, 181, 173, 1),
          bg: rgba(0, 0, 0, 0),
          attributes,
        },
      ],
    },
  ],
})

describe('escapeHtml', () => {
  it('escapes every markup-significant character', () => {
    expect(escapeHtml(`<a href="x">&'\"</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&quot;&lt;/a&gt;',
    )
  })

  it('leaves plain terminal text alone', () => {
    expect(escapeHtml('Background shell "Run full TUI suite" completed (exit code 0)')).toContain(
      '(exit code 0)',
    )
  })
})

describe('frameToHtml', () => {
  it('emits a standalone page carrying the real fg colour as css', () => {
    const html = frameToHtml({ frame: frame('hello'), title: 'probe' })

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('color:#c8b5ad')
    expect(html).toContain('hello')
  })

  it('escapes span text so terminal output can never inject markup', () => {
    const html = frameToHtml({ frame: frame('<img src=x onerror=alert(1)>'), title: 'probe' })

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })

  it('escapes the title for the same reason', () => {
    const html = frameToHtml({ frame: frame('x'), title: '</title><script>' })

    expect(html).toContain('&lt;/title&gt;&lt;script&gt;')
    expect(html).not.toContain('</title><script>')
  })

  it('maps the dim attribute to opacity, the way a queued row reads in the terminal', () => {
    const html = frameToHtml({ frame: frame('queued', TextAttributes.DIM), title: 'probe' })

    expect(html).toContain('opacity:0.55')
  })

  it('paints a background only when the cell carries one', () => {
    const withBg = frameToHtml({
      frame: {
        cols: 10,
        rows: 1,
        lines: [
          {
            spans: [
              {
                text: 'chip',
                fg: rgba(240, 233, 227, 1),
                bg: rgba(58, 51, 46, 1),
                attributes: TextAttributes.NONE,
              },
            ],
          },
        ],
      },
      title: 'probe',
    })

    expect(withBg).toContain('background-color:#3a332e')
    expect(frameToHtml({ frame: frame('plain'), title: 'probe' })).not.toContain('background-color')
  })
})
