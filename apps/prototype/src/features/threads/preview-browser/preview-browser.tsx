'use client'

import { GlobeIcon } from 'lucide-react'

import { Notice } from '@dltech/atlas-ui/ai/notice'
import { Button } from '@dltech/atlas-ui/components/button'

import { availableSpace, fitViewport, type Viewport } from '@/proto/fit-viewport'

import { EBrowserHost, useBrowserHost } from './browser-host'
import {
  activateTab,
  activeTabOf,
  closeTab,
  currentUrlOf,
  navigated,
  openTab,
  reloaded,
  steppedBack,
  steppedForward,
  updateTab,
  withField,
  withViewport,
  type BrowserTab,
} from './browser-model'
import { BrowserStage, useStageSize } from './browser-stage'
import { usePreviewBrowser, useThreadKey } from './browser-store'
import { BrowserTabStrip } from './browser-tab-strip'
import { BrowserToolbar } from './browser-toolbar'
import { DeviceMenu, deviceSummaryOf } from './device-menu'
import { resolveAddress } from './preview-sites'
import { TabPage } from './tab-page'

export function usePreviewTabCount(): number {
  return usePreviewBrowser(useThreadKey()).state.tabs.length
}

export function PreviewBrowser() {
  const runtime = useBrowserHost()
  const native = runtime === EBrowserHost.Mac
  const { state, update } = usePreviewBrowser(useThreadKey())
  const stage = useStageSize()
  const tab = activeTabOf(state)

  const handleOpen = () => update((current) => openTab({ state: current }))
  const handleActivate = (id: string) => update((current) => activateTab({ state: current, id }))
  const handleClose = (id: string) => update((current) => closeTab({ state: current, id }))

  if (!tab) {
    return (
      <Notice
        icon={<GlobeIcon />}
        title="No tabs open"
        description="Open a tab to browse the ports this sandbox exposes."
        action={
          <Button variant="outline" size="sm" onClick={handleOpen}>
            New tab
          </Button>
        }
      />
    )
  }

  const change = (next: (tab: BrowserTab) => BrowserTab) =>
    update((current) => updateTab({ state: current, id: tab.id, change: next }))
  const handleNavigate = (url: string) => change((held) => navigated({ tab: held, url }))
  const handleAddress = (input: string) => {
    const url = resolveAddress({ input, currentUrl: currentUrlOf(tab) })
    if (url !== null) handleNavigate(url)
  }
  const handleViewport = (viewport: Viewport) =>
    change((held) => withViewport({ tab: held, viewport }))
  const handleField = (args: { name: string; value: string }) =>
    change((held) => withField({ tab: held, ...args }))

  const fit = fitViewport({
    viewport: tab.viewport,
    available: availableSpace({ viewport: tab.viewport, container: stage.size }),
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserTabStrip
        tabs={state.tabs}
        activeId={state.activeId}
        onActivate={handleActivate}
        onClose={handleClose}
        onOpen={handleOpen}
      />
      <BrowserToolbar
        tab={tab}
        onBack={() => change(steppedBack)}
        onForward={() => change(steppedForward)}
        onReload={() => change(reloaded)}
        onAddress={handleAddress}
        deviceMenu={
          <DeviceMenu
            viewport={tab.viewport}
            summary={deviceSummaryOf({ viewport: tab.viewport, fit, native })}
            native={native}
            onChange={handleViewport}
          />
        }
      />
      <BrowserStage stageRef={stage.ref} viewport={tab.viewport} fit={fit} native={native}>
        <TabPage
          key={`${tab.id}|${tab.reloads}`}
          tab={tab}
          runtime={runtime}
          onNavigate={handleNavigate}
          onField={handleField}
        />
      </BrowserStage>
    </div>
  )
}
