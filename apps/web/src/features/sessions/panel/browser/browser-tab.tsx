'use client'

import { useMemo } from 'react'
import { GlobeIcon } from 'lucide-react'

import {
  PreviewBrowser,
  type PreviewBrowserTab,
  type PreviewPort,
  type Viewport,
} from '@dltech/atlas-ui/ai/preview-browser'
import { Notice } from '@dltech/atlas-ui/ai/notice'
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
} from '@/features/threads/data/preview-browser/browser-model'
import { liveKeyOf } from '@/features/threads/data/preview-browser/live-tabs'
import { resolveAddress } from '@/features/threads/data/preview-browser/resolve-address'
import { titleOf } from '@/features/threads/data/preview-browser/tab-title'
import { usePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'
import { previewPortForUrl } from '@/features/threads/data/preview-ports'
import { useFrameRegistry } from '@/features/threads/panel/preview/frame-registry'
import { PreviewTabBody } from '@/features/threads/panel/preview/preview-tab-body'
import { ETabPage, tabPageOf } from '@/features/threads/panel/preview/tab-page'

export const chromeTabOf = (args: {
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

export function BrowserTab(props: {
  sessionId: string
  ports: readonly PreviewPort[]
  loaded: boolean
}) {
  const { sessionId, loaded } = props
  const ports = useMemo(() => [...props.ports], [props.ports])
  const { state, update } = usePreviewBrowser(sessionId)
  const { opened, loading } = useFrameRegistry()
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
  const held = opened.has(liveKeyOf({ threadId: sessionId, tabId: tab.id }))
  const page = tabPageOf({ url, ports, loaded, held })
  const isLoading = (id: string) => loading.has(liveKeyOf({ threadId: sessionId, tabId: id }))
  const activeLoading = page.kind === ETabPage.Loading || isLoading(tab.id)
  const change = (next: (heldTab: BrowserTab) => BrowserTab) =>
    update(({ state: heldState }) => updateTab({ state: heldState, id: tab.id, change: next }))
  const handleNavigate = (target: string) =>
    change((heldTab) => navigated({ tab: heldTab, url: target }))
  const handleAddress = (input: string) => {
    const target = resolveAddress({ input, currentUrl: url, ports, allowExternal: true })
    if (target !== null) handleNavigate(target)
  }
  const handleViewport = (viewport: Viewport) =>
    change((heldTab) => withViewport({ tab: heldTab, viewport }))

  return (
    <PreviewBrowser
      tabs={state.tabs.map((heldTab) =>
        chromeTabOf({
          tab: heldTab,
          ports,
          loading: heldTab.id === tab.id ? activeLoading : isLoading(heldTab.id),
        }),
      )}
      activeId={tab.id}
      loading={activeLoading}
      onActivate={(id) => update(({ state: heldState }) => activateTab({ state: heldState, id }))}
      onClose={(id) => update(({ state: heldState }) => closeTab({ state: heldState, id }))}
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
        threadId={sessionId}
        tabId={tab.id}
        url={url}
        page={page}
        ports={ports}
        onNavigate={handleNavigate}
      />
    </PreviewBrowser>
  )
}
