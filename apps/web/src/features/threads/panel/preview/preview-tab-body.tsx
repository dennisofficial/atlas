'use client'

import { useEffect, useState } from 'react'
import { ExternalLinkIcon, GlobeIcon } from 'lucide-react'

import { Notice } from '@dltech/atlas-ui/ai/notice'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'
import { PreviewNewTab, PreviewOffline } from '@dltech/atlas-ui/ai/preview-new-tab'
import { Button } from '@dltech/atlas-ui/components/button'

import { EPreviewGate } from '@/features/desktop/use-preview-origins'
import { useHasNativeBrowser } from '@/features/desktop/use-has-native-browser'

import { liveKeyOf } from '../../data/preview-browser/live-tabs'
import { PaneSlot } from './desktop/pane-slot'
import { paneTargetIdOf } from './desktop/pane-target'
import { EPaneMode, usePaneMode } from './desktop/use-pane-mode'
import { changeRegistry, hidden, shown, unloaded, useFrameRegistry } from './frame-registry'
import { ETabPage, type TabPage } from './tab-page'

function PreviewSlot(props: { threadId: string; tabId: string }) {
  const { threadId, tabId } = props
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (element === null) return
    changeRegistry((registry) => shown({ registry, slot: { threadId, tabId, element } }))
    return () => changeRegistry((registry) => hidden({ registry, element }))
  }, [element, threadId, tabId])
  return <div ref={setElement} className="size-full" />
}

function ExternalNotice({ url }: { url: string }) {
  return (
    <Notice
      icon={<GlobeIcon />}
      title="This address can't open in the preview"
      description={`${url} is not a web page. The preview browser loads http and https addresses.`}
    />
  )
}

function OutsideSessionBar({ url }: { url: string }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2 text-xs text-muted-foreground">
      <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Outside this session. If the page stays blank, the site blocks being embedded.
      </span>
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<a href={url} target="_blank" rel="noreferrer noopener" />}
      >
        <ExternalLinkIcon data-icon="inline-start" />
        Open in your browser
      </Button>
    </div>
  )
}

function BlockedNotice() {
  return (
    <Notice
      icon={<GlobeIcon />}
      title="Preview unavailable"
      description="The desktop app couldn't allow this preview's origin, so it can't be shown here. Reload the window to try again."
    />
  )
}

export function PreviewTabBody(props: {
  threadId: string
  tabId: string
  url: string
  page: TabPage
  ports: PreviewPort[]
  onNavigate: (url: string) => void
}) {
  const { threadId, tabId, url, page, ports, onNavigate } = props
  const { gate } = useFrameRegistry()
  const nativeBrowser = useHasNativeBrowser()
  const paneMode = usePaneMode()
  // The shell draws a real browser view under the slot, so neither the embedded-frame fallbacks nor
  // the "this site blocks embedding" bar describe what is on screen.
  const inShell = paneMode === EPaneMode.Shell
  const key = liveKeyOf({ threadId, tabId })
  const framed =
    page.kind === ETabPage.Frame || page.kind === ETabPage.Loading || page.kind === ETabPage.Held
  useEffect(() => {
    if (!framed) changeRegistry((registry) => unloaded({ registry, key }))
  }, [framed, key])

  if (page.kind === ETabPage.NewTab) {
    return <PreviewNewTab ports={ports} onOpen={(port) => onNavigate(port.url)} />
  }
  if (page.kind === ETabPage.Loading) return null
  if (page.kind === ETabPage.External) return <ExternalNotice url={url} />
  if (page.kind === ETabPage.Offline) return <PreviewOffline port={page.port} />
  if (!inShell && !nativeBrowser && gate === EPreviewGate.Failed) return <BlockedNotice />
  return (
    <div className="flex h-full min-h-0 flex-col">
      {page.kind === ETabPage.Frame && page.port === undefined && !inShell && !nativeBrowser ? (
        <OutsideSessionBar url={url} />
      ) : null}
      <div className="min-h-0 flex-1">
        {paneMode === EPaneMode.Shell ? (
          <PaneSlot id={paneTargetIdOf({ threadId, tabId })} url={url} />
        ) : (
          <PreviewSlot threadId={threadId} tabId={tabId} />
        )}
      </div>
    </div>
  )
}
