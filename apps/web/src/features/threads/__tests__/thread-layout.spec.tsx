import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import { ERightTab } from '../panel/right-tab'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import { EMPTY_DETAILS } from '../panel/details/details-input'
import { ThreadLayout, type ThreadLayoutPanel } from '../thread-layout'

const panel: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  loaded: true,
  error: null,
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
  toggleContextFile: () => undefined,
  closeContextFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

const router = { push: () => undefined } as unknown as AppRouterInstance

function renderLayout(overrides: Partial<ThreadLayoutPanel> = {}): string {
  const rightPanel: ThreadLayoutPanel = {
    tab: ERightTab.Agents,
    setTab: () => undefined,
    sheetOpen: false,
    setSheetOpen: () => undefined,
    layout: undefined,
    rememberLayout: () => undefined,
    collapsed: false,
    setCollapsed: () => undefined,
    ...overrides,
  }
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <ThreadPanelProvider value={panel}>
        <ThreadLayout rightPanel={rightPanel}>
          <p>transcript-body</p>
        </ThreadLayout>
      </ThreadPanelProvider>
    </AppRouterContext.Provider>,
  )
}

describe('ThreadLayout', () => {
  it('renders the transcript beside the right panel on desktop', () => {
    const html = renderLayout()
    expect(html).toContain('transcript-body')
    expect(html).toContain('data-slot="resizable-panel-group"')
    expect(html).toContain('>Terminal<')
  })

  it('marks the panel inert while it is collapsed', () => {
    expect(renderLayout({ collapsed: true })).toContain('inert')
    expect(renderLayout({ collapsed: false })).not.toContain('inert')
  })
})
