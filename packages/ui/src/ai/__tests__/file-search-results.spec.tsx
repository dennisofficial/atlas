import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FileSearchResults, splitPath } from '../file-search-results'

describe('splitPath', () => {
  it('separates the directory from the basename', () => {
    expect(splitPath('a/b/c.ts')).toEqual({ directory: 'a/b/', name: 'c.ts', nameStart: 4 })
    expect(splitPath('c.ts')).toEqual({ directory: '', name: 'c.ts', nameStart: 0 })
  })
})

describe('FileSearchResults', () => {
  it('marks matched characters and the active option', () => {
    const html = renderToStaticMarkup(
      <FileSearchResults
        active={1}
        hits={[
          { path: 'a/b.ts', positions: [2] },
          { path: 'c.ts', positions: [0] },
        ]}
      />,
    )
    expect(html).toContain('<mark')
    expect(html).toContain('role="listbox"')
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
  })
})
