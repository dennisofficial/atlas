import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import type { PreviewsState } from '../../../data/use-previews'
import type { ThreadPanelValue } from '../../thread-panel-context'

const URL_A = 'https://3000-abcdefghij.byatlas.dev/'

const WEB: PreviewPort = {
  id: 'service:svc_1',
  port: 3000,
  label: 'Web',
  url: URL_A,
  status: EPreviewStatus.Live,
}

const originalError = console.error

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  console.error = () => undefined
})

afterAll(async () => {
  console.error = originalError
  await GlobalRegistrator.unregister()
})

const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 20)))

async function mountApp() {
  const { createRoot } = await import('react-dom/client')
  const { NativeFrameLayer } = await import('../native-frame-layer')
  const { PreviewTab } = await import('../../preview-tab')
  const { ThreadPanelProvider } = await import('../../thread-panel-context')
  const { EMPTY_DETAILS } = await import('../../details/details-input')
  const { updatePreviewBrowser } = await import('../../../data/preview-browser/use-preview-browser')
  const { navigated, updateTab } = await import('../../../data/preview-browser/browser-model')

  for (const threadId of ['t1', 't2']) {
    updatePreviewBrowser({
      threadId,
      change: ({ state }) =>
        updateTab({
          state,
          id: 'tab-1',
          change: (tab) => navigated({ tab, url: URL_A }),
        }),
    })
  }

  const panelOf = (threadId: string): ThreadPanelValue => ({
    threadId,
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
    closeContextFile: () => undefined,
    closePanel: () => undefined,
    refreshPod: () => undefined,
  })

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const view = (threadId: string, data: PreviewsState): ReactNode => (
    <>
      <ThreadPanelProvider key={threadId} value={panelOf(threadId)}>
        <PreviewTab data={data} />
      </ThreadPanelProvider>
      <NativeFrameLayer />
    </>
  )
  const show = async (args: { threadId: string; loaded: boolean }) => {
    const data = { ports: args.loaded ? [WEB] : [], loaded: args.loaded, openUrl: () => undefined }
    await act(async () => root.render(view(args.threadId, data)))
    await settle()
  }
  return { host, show }
}

describe('native frame layer', () => {
  it('keeps one native view per opened tab across sessions', async () => {
    const { host, show } = await mountApp()
    const views = () => [...host.querySelectorAll('electrobun-webview')]
    const wrappers = () => views().map((view) => view.parentElement)

    await show({ threadId: 't1', loaded: true })
    const first = views()[0]
    expect(first?.getAttribute('partition')).toBe('persist:atlas-browser')
    expect(first?.getAttribute('masks')).toContain('[data-preview-clip]')

    await show({ threadId: 't2', loaded: true })
    expect(views()).toHaveLength(2)
    expect(views()[0]).toBe(first)

    await show({ threadId: 't1', loaded: false })
    const visible = wrappers().filter((wrapper) => !wrapper?.hasAttribute('inert'))
    expect(visible).toHaveLength(1)
    expect(visible[0]?.querySelector('electrobun-webview')).toBe(first)
    expect(visible[0]?.className).not.toContain('invisible')
  })

  it('draws four fixed clip strips around the stage', async () => {
    const { host, show } = await mountApp()
    await show({ threadId: 't1', loaded: true })
    expect(host.querySelectorAll('[data-preview-clip]')).toHaveLength(4)
  })
})
