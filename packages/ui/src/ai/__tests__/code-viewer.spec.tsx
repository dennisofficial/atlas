import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CodeViewer, HIGHLIGHT_LINE_LIMIT, linesOf, normalizedMarks } from '../code-viewer'

describe('linesOf', () => {
  it('drops the empty line after a trailing newline', () => {
    expect(linesOf('a\nb\n')).toEqual(['a', 'b'])
    expect(linesOf('')).toEqual([''])
  })
})

describe('normalizedMarks', () => {
  it('moves a deletion past the last line onto it as deleted-below', () => {
    const marks = normalizedMarks({ marks: new Map([[4, 'deleted-above']]), lineCount: 3 })
    expect(marks.get(3)).toBe('deleted-below')
  })
})

describe('CodeViewer', () => {
  it('renders numbered lines with a mark for each changed line', () => {
    const html = renderToStaticMarkup(
      <CodeViewer
        path="a.ts"
        content={'one\ntwo\nthree'}
        language="typescript"
        marks={
          new Map([
            [1, 'added'],
            [2, 'modified'],
            [3, 'deleted-above'],
          ])
        }
      />,
    )
    expect(html).toContain('data-line="3"')
    expect(html).toContain('data-mark="added"')
    expect(html).toContain('data-mark="modified"')
    expect(html).toContain('data-mark="deleted-above"')
    expect(html).toContain('bg-diff-add-foreground')
    expect(html).toContain('bg-warning')
    expect(html).toContain('Contents of a.ts')
  })

  it('says highlighting is off for very large files', () => {
    const content = Array.from({ length: HIGHLIGHT_LINE_LIMIT + 1 }, () => 'x').join('\n')
    expect(
      renderToStaticMarkup(<CodeViewer path="big.ts" content={content} language="ts" />),
    ).toContain('Syntax highlighting is off')
  })
})
