'use client'

import { useEffect, useState } from 'react'
import { ExternalLinkIcon, GlobeIcon } from 'lucide-react'

import { Notice } from '@dltech/atlas-ui/ai/notice'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'
import { PreviewNewTab, PreviewOffline } from '@dltech/atlas-ui/ai/preview-new-tab'
import { Button } from '@dltech/atlas-ui/components/button'

import { liveKeyOf } from '../../data/preview-browser/live-tabs'
import { changeRegistry, hidden, shown, unloaded } from './frame-registry'
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
      title="This page opens outside Atlas"
      description="The preview only loads this session's exposed ports. Open the page in your browser instead."
      action={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Open in your browser
        </Button>
      }
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
  const key = liveKeyOf({ threadId, tabId })
  const framed = page.kind === ETabPage.Frame || page.kind === ETabPage.Loading
  useEffect(() => {
    if (!framed) changeRegistry((registry) => unloaded({ registry, key }))
  }, [framed, key])

  if (page.kind === ETabPage.NewTab) {
    return <PreviewNewTab ports={ports} onOpen={(port) => onNavigate(port.url)} />
  }
  if (page.kind === ETabPage.Loading) return null
  if (page.kind === ETabPage.External) return <ExternalNotice url={url} />
  if (page.kind === ETabPage.Offline) return <PreviewOffline port={page.port} />
  return <PreviewSlot threadId={threadId} tabId={tabId} />
}
