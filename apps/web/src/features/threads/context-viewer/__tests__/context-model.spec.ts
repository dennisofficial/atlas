import { describe, expect, it } from 'bun:test'

import {
  copyTextOf,
  downloadNameOf,
  downloadOf,
  ERenderKind,
  fileSizeLabelOf,
  isHtmlPath,
  isMarkdownPath,
  renderableHtmlOf,
  renderKindOf,
} from '../context-model'

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

describe('downloadOf', () => {
  it('saves text as its own bytes and a binary file as the bytes it was', async () => {
    const text = downloadOf({ type: 'text', content: 'hi', truncated: false })
    expect(await text?.text()).toBe('hi')

    const bytes = new Uint8Array([1, 0, 2])
    const binary = downloadOf({
      type: 'binary',
      data: Buffer.from(bytes).toString('base64'),
      bytes: 3,
    })
    expect(new Uint8Array(await binary?.arrayBuffer())).toEqual(bytes)

    expect(downloadOf({ type: 'refused', reason: 'big' })).toBeNull()
  })
})

describe('downloadNameOf', () => {
  it('names the download after the file', () => {
    expect(downloadNameOf('artifacts/workflows-design-pack.zip')).toBe('workflows-design-pack.zip')
    expect(downloadNameOf('plan.md')).toBe('plan.md')
  })
})

describe('fileSizeLabelOf', () => {
  it('reads bytes, then KiB, then MiB', () => {
    expect(fileSizeLabelOf(3)).toBe('3 B')
    expect(fileSizeLabelOf(2048)).toBe('2.0 KiB')
    expect(fileSizeLabelOf(5 * 1024 * 1024)).toBe('5.0 MiB')
  })
})
