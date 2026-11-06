'use client'

import type { ReactNode } from 'react'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@dltech/atlas-ui/components/resizable'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'
import { useIsMobile } from '@dltech/atlas-ui/hooks/use-mobile'

import { RightPanel } from './panel/right-panel'
import type { ERightTab } from './panel/right-tab'
import type { PaneLayout } from './panel/pane-layout-memory'

export type ThreadLayoutProps = {
  children: ReactNode
  tab: ERightTab
  onTabChange: (tab: ERightTab) => void
  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  layout?: PaneLayout
  onLayoutChange?: (layout: PaneLayout) => void
}

export function ThreadLayout(props: ThreadLayoutProps) {
  const { children, tab, onTabChange, sheetOpen, onSheetOpenChange, layout, onLayoutChange } = props
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
          <SheetContent side="right" className="gap-0 bg-card p-0">
            <div className="sr-only">
              <SheetHeader>
                <SheetTitle>Thread panel</SheetTitle>
                <SheetDescription>
                  Details, changes, files, terminal and preview for this thread.
                </SheetDescription>
              </SheetHeader>
            </div>
            <RightPanel tab={tab} onTabChange={onTabChange} tabBarClassName="pr-12" />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={layout}
      onLayoutChanged={(next, meta) => {
        if (meta.isUserInteraction) onLayoutChange?.(meta.requestedLayout ?? next)
      }}
    >
      <ResizablePanel id="transcript" minSize="25%">
        <div className="flex h-full min-w-0 flex-col">{children}</div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="right-panel" defaultSize="50%" minSize="26%" maxSize="75%">
        <RightPanel tab={tab} onTabChange={onTabChange} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
