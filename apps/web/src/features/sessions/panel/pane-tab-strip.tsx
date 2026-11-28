'use client'

import { EyeIcon, FolderIcon, GitCompareIcon, InfoIcon, TerminalIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ALL_PANE_TABS, ESessionPaneTab, PANE_TAB_LABEL } from './pane-tab'

export const PANE_TAB_ICON: Record<ESessionPaneTab, LucideIcon> = {
  [ESessionPaneTab.Details]: InfoIcon,
  [ESessionPaneTab.Changes]: GitCompareIcon,
  [ESessionPaneTab.Files]: FolderIcon,
  [ESessionPaneTab.Terminal]: TerminalIcon,
  [ESessionPaneTab.Browser]: EyeIcon,
}

export type PaneTabStripProps = {
  tabs?: readonly ESessionPaneTab[]
  counts: Partial<Record<ESessionPaneTab, number>>
  className?: string
}

export function PaneTabStrip({ tabs = ALL_PANE_TABS, counts, className }: PaneTabStripProps) {
  return (
    <div className={cn('@container flex h-10 shrink-0 items-end border-b px-3', className)}>
      <TabsList variant="line" className="justify-start">
        {tabs.map((value) => {
          const Icon = PANE_TAB_ICON[value]
          const count = counts[value] ?? 0
          return (
            <TabsTrigger
              key={value}
              value={value}
              title={PANE_TAB_LABEL[value]}
              className="group/tab flex-none"
            >
              <Icon aria-hidden />
              <span className="sr-only group-data-active/tab:not-sr-only @lg:not-sr-only">
                {PANE_TAB_LABEL[value]}
              </span>
              {count > 0 ? <span className="font-mono text-xs tabular-nums">{count}</span> : null}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </div>
  )
}
