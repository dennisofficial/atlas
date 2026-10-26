import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ERightTab } from '../panel/right-tab'
import { ThreadLayout } from '../thread-layout'

describe('ThreadLayout', () => {
  it('renders the transcript beside the right panel on desktop', () => {
    const html = renderToStaticMarkup(
      <ThreadLayout
        tab={ERightTab.Agents}
        onTabChange={() => undefined}
        sheetOpen={false}
        onSheetOpenChange={() => undefined}
      >
        <p>transcript-body</p>
      </ThreadLayout>,
    )
    expect(html).toContain('transcript-body')
    expect(html).toContain('data-slot="resizable-panel-group"')
    expect(html).toContain('>Terminal<')
  })
})
