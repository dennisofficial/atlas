'use client'

import { EyeIcon, FolderIcon, GitCompareIcon, InfoIcon, TerminalIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@dltech/atlas-ui/lib/utils'
import { TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { ERightTab, TAB_LABEL } from './right-tab'

const TAB_ICON: Record<ERightTab, LucideIcon> = {
  [ERightTab.Details]: InfoIcon,
  [ERightTab.Changes]: GitCompareIcon,
  [ERightTab.Files]: FolderIcon,
  [ERightTab.Terminal]: TerminalIcon,
  [ERightTab.Preview]: EyeIcon,
}

export type RightTabStripProps = {
  counts: Partial<Record<ERightTab, number>>
  className?: string
}

export function RightTabStrip({ counts, className }: RightTabStripProps) {
  return (
    <div className={cn('@container flex h-10 shrink-0 items-end border-b px-3', className)}>
      <TabsList variant="line" className="justify-start">
        {Object.values(ERightTab).map((value) => {
          const Icon = TAB_ICON[value]
          const count = counts[value] ?? 0
          return (
            <TabsTrigger
              key={value}
              value={value}
              title={TAB_LABEL[value]}
              className="group/tab flex-none"
            >
              <Icon aria-hidden />
              <span className="sr-only group-data-active/tab:not-sr-only @lg:not-sr-only">
                {TAB_LABEL[value]}
              </span>
              {count > 0 ? <span className="font-mono text-xs tabular-nums">{count}</span> : null}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </div>
  )
}
