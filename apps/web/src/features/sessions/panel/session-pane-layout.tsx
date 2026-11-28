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

import type { SessionPaneState } from './pane-state'
import { desktopPaneTab } from './pane-tab'
import { SessionPane } from './session-pane'
import { SessionSplit } from './session-split'

export type SessionPaneLayoutProps = {
  children: ReactNode
} & Pick<
  SessionPaneState,
  | 'tab'
  | 'setTab'
  | 'sheetOpen'
  | 'setSheetOpen'
  | 'layout'
  | 'rememberLayout'
  | 'collapsed'
  | 'setCollapsed'
>

export function SessionPaneLayout(props: SessionPaneLayoutProps) {
  const { children } = props
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <Sheet open={props.sheetOpen} onOpenChange={props.setSheetOpen}>
          <SheetContent side="right" className="gap-0 bg-card p-0">
            <div className="sr-only">
              <SheetHeader>
                <SheetTitle>Session panel</SheetTitle>
                <SheetDescription>
                  Details, changes, files, terminal and browser for this session.
                </SheetDescription>
              </SheetHeader>
            </div>
            <SessionPane tab={props.tab} onTabChange={props.setTab} tabBarClassName="pr-12" />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <SessionSplit
      tab={desktopPaneTab(props.tab)}
      onTabChange={props.setTab}
      layout={props.layout}
      onLayoutChange={props.rememberLayout}
      collapsed={props.collapsed}
      onCollapsedChange={props.setCollapsed}
    >
      {children}
    </SessionSplit>
  )
}
