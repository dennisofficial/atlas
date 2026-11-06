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
  const { PreviewFrameLayer } = await import('../preview-frame-layer')
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
      <PreviewFrameLayer />
    </>
  )
  const show = async (args: { threadId: string; loaded: boolean }) => {
    const data = {
      ports: args.loaded ? [WEB] : [],
      loaded: args.loaded,
      openUrl: () => undefined,
    }
    await act(async () => root.render(view(args.threadId, data)))
    await settle()
  }
  return { host, show }
}

describe('returning to a session', () => {
  it('shows the frame it left running while the session reconnects', async () => {
    const { host, show } = await mountApp()
    const wrappers = () =>
      [...host.querySelectorAll('iframe')].map((iframe) => iframe.parentElement)

    await show({ threadId: 't1', loaded: true })
    const first = host.querySelector('iframe')
    expect(first).not.toBeNull()

    await show({ threadId: 't2', loaded: true })
    expect(wrappers()).toHaveLength(2)

    await show({ threadId: 't1', loaded: false })
    const visible = wrappers().filter((wrapper) => !wrapper?.hasAttribute('inert'))
    expect(visible).toHaveLength(1)
    expect(visible[0]?.querySelector('iframe')).toBe(first)
  })
})

describe('preview frame permissions', () => {
  it('lets the page download, pop out, use the clipboard and go fullscreen but not navigate Atlas', async () => {
    const { host, show } = await mountApp()
    await show({ threadId: 't1', loaded: true })
    const iframe = host.querySelector('iframe')
    const sandbox = (iframe?.getAttribute('sandbox') ?? '').split(' ')
    const allow = (iframe?.getAttribute('allow') ?? '').split('; ')

    expect(sandbox).toEqual(
      expect.arrayContaining([
        'allow-scripts',
        'allow-same-origin',
        'allow-downloads',
        'allow-popups-to-escape-sandbox',
        'allow-storage-access-by-user-activation',
      ]),
    )
    expect(sandbox.some((token) => token.startsWith('allow-top-navigation'))).toBe(false)
    expect(allow).toEqual(
      expect.arrayContaining(['clipboard-write', 'fullscreen', 'camera', 'microphone']),
    )
  })
})
