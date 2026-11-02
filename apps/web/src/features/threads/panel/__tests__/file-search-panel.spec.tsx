import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FileSearchBody } from '../file-search-panel'

describe('FileSearchBody', () => {
  it('shows the tree children and an empty search box before any query', () => {
    const html = renderToStaticMarkup(
      <FileSearchBody
        channel={{ request: async () => ({}) } as never}
        refreshKey={0}
        changes={new Map()}
        ignored={new Set()}
        selected={undefined}
        onOpen={() => undefined}
      >
        <p>the tree</p>
      </FileSearchBody>,
    )
    expect(html).toContain('the tree')
    expect(html).toContain('aria-label="Search files by name"')
    expect(html).not.toContain('role="listbox"')
  })
})
