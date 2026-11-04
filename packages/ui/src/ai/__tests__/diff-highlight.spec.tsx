import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { loadHighlighter } from '#lib/highlighter'

import type { DiffLine } from '../diff-viewer'
import { diffSides, placeHighlighted } from '../internal/diff-highlight'

const lines: DiffLine[] = [
  { kind: 'context', text: 'const a = 1', oldNumber: 1, newNumber: 1 },
  { kind: 'remove', text: "const b = 'old'", oldNumber: 2 },
  { kind: 'add', text: "const b = 'new'", newNumber: 2 },
  { kind: 'gap', text: '12 unchanged lines' },
  { kind: 'context', text: 'export { a, b }', oldNumber: 15, newNumber: 15 },
]

describe('diffSides', () => {
  it('splits the hunk into the file as it was and as it will be, skipping gaps', () => {
    const { older, newer } = diffSides(lines)

    expect(older).toEqual({
      texts: ['const a = 1', "const b = 'old'", 'export { a, b }'],
      rows: [0, 1, 4],
    })
    expect(newer).toEqual({
      texts: ['const a = 1', "const b = 'new'", 'export { a, b }'],
      rows: [0, 2, 4],
    })
  })
})

describe('placeHighlighted', () => {
  it('puts each highlighted line back on its diff row and leaves gaps empty', async () => {
    const highlighter = await loadHighlighter('typescript')
    if (highlighter === null) throw new Error('typescript should be highlightable')
    const { older, newer } = diffSides(lines)

    const rows = placeHighlighted({
      lineCount: lines.length,
      sides: [
        { side: older, highlighted: highlighter.highlight(older.texts.join('\n')).lines },
        { side: newer, highlighted: highlighter.highlight(newer.texts.join('\n')).lines },
      ],
    })
    const html = rows.map((row) => (row === null ? null : renderToStaticMarkup(<>{row}</>)))

    expect(html[3]).toBeNull()
    expect(html[1]).toContain('--shiki-dark')
    expect(html[1]).toContain('old')
    expect(html[2]).toContain('new')
    expect(html[4]).toContain('export')
  })
})
