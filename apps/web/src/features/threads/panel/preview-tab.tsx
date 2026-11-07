'use client'

import { GlobeIcon } from 'lucide-react'

import { Notice } from '@dltech/atlas-ui/ai/notice'
import {
  PreviewBrowser,
  type PreviewBrowserTab,
  type PreviewPort,
  type Viewport,
} from '@dltech/atlas-ui/ai/preview-browser'
import { Button } from '@dltech/atlas-ui/components/button'

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
  reloaded,
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
import { useFrameRegistry } from './preview/frame-registry'
import { PreviewTabBody } from './preview/preview-tab-body'
import { ETabPage, tabPageOf } from './preview/tab-page'
import { useThreadPanel } from './thread-panel-context'

const chromeTabOf = (args: {
  tab: BrowserTab
  ports: PreviewPort[]
  loading: boolean
}): PreviewBrowserTab => {
  const url = currentUrlOf(args.tab)
  return {
    id: args.tab.id,
    title: titleOf({ url, title: args.tab.title }),
    url,
    status: previewPortForUrl({ url, ports: args.ports })?.status,
    loading: args.loading,
  }
}

export function PreviewTab({ data }: { data: PreviewsState }) {
  const { threadId } = useThreadPanel()
  const { state, update } = usePreviewBrowser(threadId)
  const { opened, loading } = useFrameRegistry()
  const { ports, loaded } = data
  const tab = activeTabOf(state)
  const handleOpen = () => update(({ state: held }) => openTab({ state: held }))

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
  const held = opened.has(liveKeyOf({ threadId, tabId: tab.id }))
  const page = tabPageOf({ url, ports, loaded, held })
  const isLoading = (id: string) => loading.has(liveKeyOf({ threadId, tabId: id }))
  const activeLoading = page.kind === ETabPage.Loading || isLoading(tab.id)
  const change = (next: (held: BrowserTab) => BrowserTab) =>
    update(({ state: held }) => updateTab({ state: held, id: tab.id, change: next }))
  const handleNavigate = (target: string) => change((held) => navigated({ tab: held, url: target }))
  const handleAddress = (input: string) => {
    const target = resolveAddress({ input, currentUrl: url, ports, allowExternal: true })
    if (target !== null) handleNavigate(target)
  }
  const handleViewport = (viewport: Viewport) =>
    change((held) => withViewport({ tab: held, viewport }))

  return (
    <PreviewBrowser
      tabs={state.tabs.map((held) =>
        chromeTabOf({
          tab: held,
          ports,
          loading: held.id === tab.id ? activeLoading : isLoading(held.id),
        }),
      )}
      activeId={tab.id}
      loading={activeLoading}
      onActivate={(id) => update(({ state: held }) => activateTab({ state: held, id }))}
      onClose={(id) => update(({ state: held }) => closeTab({ state: held, id }))}
      onOpen={handleOpen}
      address={url === NEW_TAB_URL ? '' : url}
      canGoBack={canGoBack(tab)}
      canGoForward={canGoForward(tab)}
      canReload={page.kind === ETabPage.Frame || page.kind === ETabPage.Held}
      onBack={() => change(steppedBack)}
      onForward={() => change(steppedForward)}
      onReload={() => change(reloaded)}
      onAddress={handleAddress}
      viewport={tab.viewport}
      onViewportChange={handleViewport}
    >
      <PreviewTabBody
        threadId={threadId}
        tabId={tab.id}
        page={page}
        ports={ports}
        onNavigate={handleNavigate}
      />
    </PreviewBrowser>
  )
}
