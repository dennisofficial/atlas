import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import { openTab } from '@/features/threads/data/preview-browser/browser-model'
import { updatePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'

import { SessionPane } from '../session-pane'
import { ESessionPaneTab, PANE_TAB_LABEL } from '../pane-tab'
import { SessionCheckoutScope } from '../checkout-scope'
import { SessionPaneProvider } from '../pane-value'
import { paneValueFixture, populatedPaneValue } from './fixture'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const roots = new Set<Root>()

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  window.localStorage.clear()
})

const render = (tab: ESessionPaneTab | undefined, value = populatedPaneValue()): string =>
  renderToStaticMarkup(
    <TestQueryProvider client={createTestQueryClient()}>
      <SessionPaneProvider value={value}>
        <SessionCheckoutScope>
          <SessionPane tab={tab} onTabChange={() => undefined} />
        </SessionCheckoutScope>
      </SessionPaneProvider>
    </TestQueryProvider>,
  )

async function mountWithOpenPages(sessionId: string, pages: string[]) {
  for (const url of pages) {
    updatePreviewBrowser({
      threadId: sessionId,
      change: ({ state }) => openTab({ state, url }),
    })
  }
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  await act(async () =>
    root.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <SessionPaneProvider value={paneValueFixture({ sessionId })}>
          <SessionPane tab={ESessionPaneTab.Browser} onTabChange={() => undefined} />
        </SessionPaneProvider>
      </TestQueryProvider>,
    ),
  )
  return container
}

describe('SessionPane', () => {
  it('offers the tools in a launcher until one is picked', () => {
    const html = render(undefined)
    expect(html).toContain('data-tool-launcher')
    for (const label of ['Changes', 'Files', 'Terminal', 'Browser']) expect(html).toContain(label)
  })

  it('lists the five tabs in order', () => {
    const html = render(ESessionPaneTab.Details)
    const positions = Object.values(PANE_TAB_LABEL).map((label) => html.indexOf(`>${label}`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('renders the details of the streamed view on the Details tab', () => {
    const html = render(ESessionPaneTab.Details)
    expect(html).toContain('data-session-summary')
    expect(html).toContain('Rebase ui on shadcn base-nova')
  })

  it('renders the terminal tab where the empty state used to be', () => {
    const html = render(ESessionPaneTab.Terminal)
    expect(html).toContain('No terminals')
    expect(html).not.toContain('data-pane-empty="terminal"')
    expect(html).not.toContain('data-session-summary')
  })

  it('renders the files tab where the empty state used to be', () => {
    expect(render(ESessionPaneTab.Files)).not.toContain('data-pane-empty="files"')
  })

  it('renders the changes tab where the empty state used to be', () => {
    const html = render(ESessionPaneTab.Changes)
    expect(html).toContain('data-changes-tab="loading"')
    expect(html).not.toContain('data-pane-empty="changes"')
  })

  it('renders the browser, not an empty state, on the Browser tab', () => {
    const html = render(ESessionPaneTab.Browser)
    expect(html).toContain('aria-label="Address"')
    expect(html).not.toContain('data-pane-empty="browser"')
    expect(html).not.toContain('data-session-summary')
  })

  it('renders without a view, on a session that has streamed nothing', () => {
    expect(render(ESessionPaneTab.Details, paneValueFixture())).toContain('data-session-summary')
  })

  it('counts the open browser tabs on the strip', async () => {
    const container = await mountWithOpenPages('pane-browser-count', [
      'http://localhost:4321',
      'http://localhost:5000',
    ])
    const strip = container.textContent ?? ''
    expect(strip).toContain('Browser')
    expect(strip).toContain('2')
  })
})
