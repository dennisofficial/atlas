import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { liveKeyOf } from '../../../data/preview-browser/live-tabs'
import { resetPaneAvailability } from '../desktop/pane-client'
import type { FrameRegistry } from '../frame-registry'
import { ETabPage } from '../tab-page'

const PAGE = { kind: ETabPage.Frame, port: undefined } as const
const THREAD = 'thr-collapse'
const TAB = 'tab-collapse'
const KEY = liveKeyOf({ threadId: THREAD, tabId: TAB })

const originalError = console.error
const originalFetch = globalThis.fetch
const roots = new Map<Root, HTMLElement>()
const seen: FrameRegistry[] = []

async function mountBody() {
  const { createRoot } = await import('react-dom/client')
  const { PreviewTabBody } = await import('../preview-tab-body')
  const { PanelCollapsedProvider } = await import('../../panel-collapsed-context')
  const { useFrameRegistry } = await import('../frame-registry')

  function Probe() {
    seen.push(useFrameRegistry())
    return null
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.set(root, host)
  const view = (collapsed: boolean): ReactNode => (
    <PanelCollapsedProvider value={collapsed}>
      <PreviewTabBody
        threadId={THREAD}
        tabId={TAB}
        url="https://example.com/"
        page={PAGE}
        ports={[]}
        onNavigate={() => undefined}
      />
      <Probe />
    </PanelCollapsedProvider>
  )
  const show = async (collapsed: boolean) => {
    await act(async () => root.render(view(collapsed)))
    await act(async () => new Promise<void>((done) => setTimeout(done, 20)))
    const latest = seen.at(-1)
    if (latest === undefined) throw new Error('the probe never rendered')
    return latest
  }
  return { show }
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  console.error = () => undefined
})

afterAll(async () => {
  console.error = originalError
  globalThis.fetch = originalFetch
  await unregisterDom()
})

beforeEach(() => {
  seen.length = 0
  resetPaneAvailability()
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch
})

afterEach(async () => {
  for (const [root, host] of roots) {
    await act(async () => root.unmount())
    host.remove()
  }
  roots.clear()
  seen.length = 0
  resetPaneAvailability()
  globalThis.fetch = originalFetch
})

describe('a collapsed panel', () => {
  it('unmounts the preview slot and keeps the frame opened, then shows it again', async () => {
    const { show } = await mountBody()

    const open = await show(false)
    expect(open.visible?.element).toBeInstanceOf(HTMLElement)
    expect(open.opened.has(KEY)).toBe(true)

    const collapsed = await show(true)
    expect(collapsed.visible).toBeUndefined()
    expect(collapsed.opened.has(KEY)).toBe(true)

    const expanded = await show(false)
    expect(expanded.visible?.element).toBeInstanceOf(HTMLElement)
  })

  it('leaves a panel that is not collapsed alone', async () => {
    const { show } = await mountBody()
    const open = await show(false)
    expect(open.visible?.element).toBeInstanceOf(HTMLElement)
    expect(open.visible?.threadId).toBe(THREAD)
  })
})
