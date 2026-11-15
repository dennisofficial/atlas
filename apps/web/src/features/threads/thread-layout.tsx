'use client'

import type { ReactNode } from 'react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'
import { useIsMobile } from '@dltech/atlas-ui/hooks/use-mobile'

import { RightPanel } from './panel/right-panel'
import type { RightPanelState } from './panel/use-right-panel'
import { ThreadSplit } from './thread-split'

export type ThreadLayoutPanel = Pick<
  RightPanelState,
  | 'tab'
  | 'setTab'
  | 'sheetOpen'
  | 'setSheetOpen'
  | 'layout'
  | 'rememberLayout'
  | 'collapsed'
  | 'setCollapsed'
>

export type ThreadLayoutProps = {
  children: ReactNode
  rightPanel: ThreadLayoutPanel
}

export function ThreadLayout(props: ThreadLayoutProps) {
  const { children, rightPanel } = props
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <Sheet open={rightPanel.sheetOpen} onOpenChange={rightPanel.setSheetOpen}>
          <SheetContent side="right" className="gap-0 bg-card p-0">
            <div className="sr-only">
              <SheetHeader>
                <SheetTitle>Thread panel</SheetTitle>
                <SheetDescription>
                  Details, changes, files, terminal and preview for this thread.
                </SheetDescription>
              </SheetHeader>
            </div>
            <RightPanel
              tab={rightPanel.tab}
              onTabChange={rightPanel.setTab}
              tabBarClassName="pr-12"
            />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <ThreadSplit
      tab={rightPanel.tab}
      onTabChange={rightPanel.setTab}
      layout={rightPanel.layout}
      onLayoutChange={rightPanel.rememberLayout}
      collapsed={rightPanel.collapsed}
      onCollapsedChange={rightPanel.setCollapsed}
    >
      {children}
    </ThreadSplit>
  )
}
