import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import { ERightTab } from '../panel/right-tab'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import { EMPTY_DETAILS } from '../panel/details/details-input'
import { ThreadLayout } from '../thread-layout'

const panel: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  openContextFile: () => undefined,
  closeContextFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

const router = { push: () => undefined } as unknown as AppRouterInstance

describe('ThreadLayout', () => {
  it('renders the transcript beside the right panel on desktop', () => {
    const html = renderToStaticMarkup(
      <AppRouterContext.Provider value={router}>
        <ThreadPanelProvider value={panel}>
          <ThreadLayout
            tab={ERightTab.Agents}
            onTabChange={() => undefined}
            sheetOpen={false}
            onSheetOpenChange={() => undefined}
          >
            <p>transcript-body</p>
          </ThreadLayout>
        </ThreadPanelProvider>
      </AppRouterContext.Provider>,
    )
    expect(html).toContain('transcript-body')
    expect(html).toContain('data-slot="resizable-panel-group"')
    expect(html).toContain('>Terminal<')
  })
})
