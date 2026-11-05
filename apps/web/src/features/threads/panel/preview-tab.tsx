'use client'

import { GlobeIcon } from 'lucide-react'

import { Notice } from '@dltech/atlas-ui/ai/notice'
import {
  EStageFit,
  PreviewBrowser,
  type PreviewBrowserTab,
  type PreviewPort,
  type Viewport,
} from '@dltech/atlas-ui/ai/preview-browser'
import { Button } from '@dltech/atlas-ui/components/button'

import { useIsDesktop } from '@/features/desktop/use-is-desktop'

import {
  activateTab,
  activeTabOf,
  canGoBack,
  canGoForward,
  closeTab,
  currentUrlOf,
  navigated,
  NEW_TAB_URL,
  openTab,
  steppedBack,
  steppedForward,
  updateTab,
  withViewport,
  type BrowserTab,
} from '../data/preview-browser/browser-model'
import { liveKeyOf } from '../data/preview-browser/live-tabs'
import { resolveAddress } from '../data/preview-browser/resolve-address'
import { titleOf } from '../data/preview-browser/tab-title'
import { usePreviewBrowser } from '../data/preview-browser/use-preview-browser'
import { previewPortForUrl } from '../data/preview-ports'
import type { PreviewsState } from '../data/use-previews'
import { changeRegistry, reloadedFrame } from './preview/frame-registry'
import { useNativeNav, webviewOf } from './preview/native/native-controls'
import { PreviewTabBody } from './preview/preview-tab-body'
import { ETabPage, tabPageOf } from './preview/tab-page'
import { useThreadPanel } from './thread-panel-context'

const chromeTabOf = (args: { tab: BrowserTab; ports: PreviewPort[] }): PreviewBrowserTab => {
  const url = currentUrlOf(args.tab)
  return {
    id: args.tab.id,
    title: titleOf({ url, ports: args.ports }),
    url,
    status: previewPortForUrl({ url, ports: args.ports })?.status,
  }
}

export function PreviewTab({ data }: { data: PreviewsState }) {
  const { threadId } = useThreadPanel()
  const desktop = useIsDesktop()
  const { state, update } = usePreviewBrowser(threadId)
  const { ports, loaded } = data
  const tab = activeTabOf(state)
  const frameKey = liveKeyOf({ threadId, tabId: tab?.id ?? '' })
  const native = useNativeNav(frameKey)
  const handleOpen = () => update(({ state: held, now }) => openTab({ state: held, now }))

  if (tab === undefined) {
    return (
      <div className="flex h-full flex-col">
        <Notice
          icon={<GlobeIcon />}
          title="No tabs open"
          description="Open a tab to browse the ports this session exposes."
          action={
            <Button variant="outline" size="sm" onClick={handleOpen}>
              New tab
            </Button>
          }
        />
      </div>
    )
  }

  const url = currentUrlOf(tab)
  const page = tabPageOf({ url, ports, loaded, allowExternal: desktop })
  const change = (next: (held: BrowserTab) => BrowserTab) =>
    update(({ state: held }) => updateTab({ state: held, id: tab.id, change: next }))
  const handleNavigate = (target: string) => change((held) => navigated({ tab: held, url: target }))
  const handleAddress = (input: string) => {
    const target = resolveAddress({ input, currentUrl: url, ports, allowExternal: desktop })
    if (target !== null) handleNavigate(target)
  }
  const handleBack = () => (desktop ? webviewOf(frameKey)?.goBack() : change(steppedBack))
  const handleForward = () => (desktop ? webviewOf(frameKey)?.goForward() : change(steppedForward))
  const handleReload = () => {
    if (desktop) return webviewOf(frameKey)?.reload()
    changeRegistry((registry) => reloadedFrame({ registry, key: frameKey }))
  }
  const handleViewport = (viewport: Viewport) =>
    change((held) => withViewport({ tab: held, viewport }))

  return (
    <PreviewBrowser
      tabs={state.tabs.map((held) => chromeTabOf({ tab: held, ports }))}
      activeId={tab.id}
      onActivate={(id) => update(({ state: held, now }) => activateTab({ state: held, id, now }))}
      onClose={(id) => update(({ state: held }) => closeTab({ state: held, id }))}
      onOpen={handleOpen}
      address={url === NEW_TAB_URL ? '' : url}
      canGoBack={desktop ? (native?.canGoBack ?? false) : canGoBack(tab)}
      canGoForward={desktop ? (native?.canGoForward ?? false) : canGoForward(tab)}
      canReload={page.kind === ETabPage.Frame}
      onBack={handleBack}
      onForward={handleForward}
      onReload={handleReload}
      onAddress={handleAddress}
      viewport={tab.viewport}
      onViewportChange={handleViewport}
      stageFit={desktop ? EStageFit.Scroll : EStageFit.Scale}
    >
      <PreviewTabBody
        threadId={threadId}
        tabId={tab.id}
        url={url}
        page={page}
        ports={ports}
        onNavigate={handleNavigate}
      />
    </PreviewBrowser>
  )
}
