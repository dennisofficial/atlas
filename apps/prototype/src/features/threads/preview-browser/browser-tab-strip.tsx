import type { KeyboardEvent, MouseEvent } from 'react'
import { GlobeIcon, PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { currentUrlOf, type BrowserTab } from './browser-model'
import { EPageKind, EPortStatus, pageOf, titleOf } from './preview-sites'

const MIDDLE_BUTTON = 1

const DOT_TONE: Record<EPortStatus, string> = {
  [EPortStatus.Live]: 'bg-success',
  [EPortStatus.Starting]: 'bg-warning',
  [EPortStatus.Stopped]: 'bg-muted-foreground/50',
}

export function SiteDot({ status }: { status: EPortStatus }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT_TONE[status])} />
}

function TabFavicon({ url }: { url: string }) {
  const page = pageOf(url)
  if (page.kind === EPageKind.Site) return <SiteDot status={page.site.status} />
  return <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
}

function BrowserTabButton(props: {
  tab: BrowserTab
  active: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
}) {
  const { tab, active, onActivate, onClose } = props
  const url = currentUrlOf(tab)
  const title = titleOf(url)
  const handleActivate = () => onActivate(tab.id)
  const handleAuxClick = (event: MouseEvent) => {
    if (event.button === MIDDLE_BUTTON) onClose(tab.id)
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') handleActivate()
  }
  const handleClose = (event: MouseEvent) => {
    event.stopPropagation()
    onClose(tab.id)
  }
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={url}
      onClick={handleActivate}
      onAuxClick={handleAuxClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group/browser-tab flex h-8 max-w-48 min-w-24 flex-1 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 pr-1 pl-2.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        active
          ? '-mb-px h-8.25 border-border bg-card text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted',
      )}
    >
      <TabFavicon url={url} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${title}`}
        onClick={handleClose}
        className="opacity-0 group-hover/browser-tab:opacity-100 group-aria-selected/browser-tab:opacity-100 focus-visible:opacity-100"
      >
        <XIcon />
      </Button>
    </div>
  )
}

export function BrowserTabStrip(props: {
  tabs: BrowserTab[]
  activeId: string | undefined
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onOpen: () => void
}) {
  const { tabs, activeId, onActivate, onClose, onOpen } = props
  return (
    <div
      role="tablist"
      aria-label="Preview tabs"
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b bg-muted/40 px-1.5"
    >
      {tabs.map((tab) => (
        <BrowserTabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          onActivate={onActivate}
          onClose={onClose}
        />
      ))}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="New tab"
        onClick={onOpen}
        className="mb-1 shrink-0"
      >
        <PlusIcon />
      </Button>
    </div>
  )
}
