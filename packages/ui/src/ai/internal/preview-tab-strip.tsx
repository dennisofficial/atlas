import type { KeyboardEvent, MouseEvent } from 'react'
import { GlobeIcon, PlusIcon, XIcon } from 'lucide-react'

import { Button } from '#components/button'
import { cn } from '#lib/utils'
import { PreviewStatusDot } from './preview-status-dot'
import type { PreviewBrowserTab } from './preview-browser-types'
import { InlineSpinner } from './status-dot'

const MIDDLE_BUTTON = 1

function TabFavicon({ tab }: { tab: PreviewBrowserTab }) {
  if (tab.loading) return <InlineSpinner />
  if (tab.status) return <PreviewStatusDot status={tab.status} />
  return <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
}

interface PreviewTabProps {
  tab: PreviewBrowserTab
  active: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

function PreviewTab({ tab, active, onActivate, onClose }: PreviewTabProps) {
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
      title={tab.url}
      onClick={handleActivate}
      onAuxClick={handleAuxClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group/preview-tab flex h-8 max-w-48 min-w-24 flex-1 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 pr-1 pl-2.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        active
          ? '-mb-px h-8.25 border-border bg-card text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted',
      )}
    >
      <TabFavicon tab={tab} />
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${tab.title}`}
        onClick={handleClose}
        className="opacity-0 group-hover/preview-tab:opacity-100 group-aria-selected/preview-tab:opacity-100 focus-visible:opacity-100"
      >
        <XIcon />
      </Button>
    </div>
  )
}

export interface PreviewTabStripProps {
  tabs: PreviewBrowserTab[]
  activeId?: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onOpen: () => void
}

export function PreviewTabStrip({
  tabs,
  activeId,
  onActivate,
  onClose,
  onOpen,
}: PreviewTabStripProps) {
  return (
    <div
      role="tablist"
      aria-label="Preview tabs"
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b bg-muted/40 px-1.5"
    >
      {tabs.map((tab) => (
        <PreviewTab
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
