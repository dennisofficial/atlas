import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

type NavigationReport = { id: string; url: string }
type TitleReport = { id: string; title: string }

const navigationListeners = new Set<(report: unknown) => void>()
const titleListeners = new Set<(report: unknown) => void>()
let bridgeGone = 0

const bridge = {
  onPaneNavigated: (listener: (report: unknown) => void) => navigationListeners.add(listener),
  offPaneNavigated: (listener: (report: unknown) => void) => {
    bridgeGone += 1
    navigationListeners.delete(listener)
  },
  onPaneTitled: (listener: (report: unknown) => void) => titleListeners.add(listener),
  offPaneTitled: (listener: (report: unknown) => void) => {
    bridgeGone += 1
    titleListeners.delete(listener)
  },
}

const emitNavigation = (report: NavigationReport) => {
  for (const listener of navigationListeners) listener(report)
}

const emitTitle = (report: TitleReport) => {
  for (const listener of titleListeners) listener(report)
}

const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 0)))

type Tab = { url: string; title: string | undefined }

async function mountReportListener(threadId: string) {
  const { createRoot } = await import('react-dom/client')
  const { PaneReports } = await import('../desktop/pane-reports')
  const { currentUrlOf } = await import('../../../data/preview-browser/browser-model')
  const { activeTabOf } = await import('../../../data/preview-browser/browser-model')
  const { usePreviewBrowser } = await import('../../../data/preview-browser/use-preview-browser')

  const seen: Tab[] = []
  function Probe() {
    const tab = activeTabOf(usePreviewBrowser(threadId).state)
    if (tab !== undefined) seen.push({ url: currentUrlOf(tab), title: tab.title })
    return null
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <>
        <PaneReports />
        <Probe />
      </>,
    ),
  )
  await settle()
  const last = () => seen.at(-1) as Tab
  return { root, last }
}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Reflect.set(window, 'atlasDesktop', bridge)
})

afterAll(async () => {
  Reflect.deleteProperty(window, 'atlasDesktop')
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  navigationListeners.clear()
  titleListeners.clear()
})

describe('a report from the built-in browser', () => {
  it('moves the tab to the address the browser landed on', async () => {
    const { last } = await mountReportListener('thread-moves')
    await act(async () =>
      emitNavigation({ id: 'pane:thread-moves:tab-1', url: 'https://a.test/next' }),
    )
    await settle()
    expect(last().url).toBe('https://a.test/next')
  })

  it('keeps the tab title until the browser reports a new one', async () => {
    const { last } = await mountReportListener('thread-titles')
    await act(async () => emitTitle({ id: 'pane:thread-titles:tab-1', title: 'Inbox' }))
    await settle()
    expect(last().title).toBe('Inbox')
    await act(async () =>
      emitNavigation({ id: 'pane:thread-titles:tab-1', url: 'https://a.test/next' }),
    )
    await settle()
    expect(last()).toEqual({ url: 'https://a.test/next', title: 'Inbox' })
    await act(async () => emitTitle({ id: 'pane:thread-titles:tab-1', title: 'Files' }))
    await settle()
    expect(last().title).toBe('Files')
  })

  it('ignores an address that is not a web page', async () => {
    const { last } = await mountReportListener('thread-offweb')
    const before = last().url
    await act(async () => emitNavigation({ id: 'pane:thread-offweb:tab-1', url: 'about:blank' }))
    await settle()
    expect(last().url).toBe(before)
  })

  it('ignores a report about a target this session does not hold', async () => {
    const { last } = await mountReportListener('thread-stranger')
    const before = last()
    await act(async () =>
      emitNavigation({ id: 'pane:other-thread:tab-1', url: 'https://a.test/x' }),
    )
    await settle()
    expect(last()).toEqual(before)
  })

  it('stops listening when the app goes away', async () => {
    const { root } = await mountReportListener('thread-unmounts')
    expect(navigationListeners.size).toBe(1)
    await act(async () => root.unmount())
    expect(navigationListeners.size).toBe(0)
    expect(titleListeners.size).toBe(0)
    expect(bridgeGone).toBe(2)
  })
})
