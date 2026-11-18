'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useGroupRef,
} from '@dltech/atlas-ui/components/resizable'

import { type PaneLayout } from '@/features/threads/panel/pane-layout-memory'
import {
  COLLAPSED_PANE_LAYOUT,
  layoutForCollapse,
  paneCommitOf,
  RIGHT_PANE,
  TRANSCRIPT_PANE,
} from '@/features/threads/panel/pane-split'
import { PanelCollapsedProvider } from '@/features/threads/panel/panel-collapsed-context'

import type { ESessionPaneTab } from './pane-tab'
import { SessionPane } from './session-pane'

export type SessionSplitProps = {
  children: ReactNode
  tab: ESessionPaneTab
  onTabChange: (tab: ESessionPaneTab) => void
  layout: PaneLayout | undefined
  onLayoutChange: (layout: PaneLayout) => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function SessionSplit(props: SessionSplitProps) {
  const { children, tab, onTabChange, layout, onLayoutChange, collapsed, onCollapsedChange } = props
  const groupRef = useGroupRef()
  const expandedRef = useRef(layout)
  const collapsedRef = useRef(collapsed)
  const [initialLayout] = useState<PaneLayout | undefined>(() =>
    collapsed ? COLLAPSED_PANE_LAYOUT : layout,
  )

  useLayoutEffect(() => {
    collapsedRef.current = collapsed
  }, [collapsed])

  const reconcile = useCallback(() => {
    const group = groupRef.current
    if (group === null) return
    const next = layoutForCollapse({
      current: group.getLayout(),
      collapsed: collapsedRef.current,
      expanded: expandedRef.current,
    })
    if (next) group.setLayout(next)
  }, [groupRef])

  useEffect(() => reconcile(), [collapsed, reconcile])

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={initialLayout}
      groupRef={groupRef}
      onLayoutChanged={(next, meta) => {
        const commit = paneCommitOf({
          layout: next,
          requestedLayout: meta.requestedLayout,
          isUserInteraction: meta.isUserInteraction,
        })
        if (commit.remember) {
          expandedRef.current = commit.remember
          onLayoutChange(commit.remember)
        }
        if (commit.collapsed !== undefined && commit.collapsed !== collapsed) {
          onCollapsedChange(commit.collapsed)
        }
        if (!meta.isUserInteraction) queueMicrotask(reconcile)
      }}
    >
      <ResizablePanel id={TRANSCRIPT_PANE} minSize="25%">
        <div className="flex h-full min-w-0 flex-col">{children}</div>
      </ResizablePanel>
      <ResizableHandle disableDoubleClick={collapsed} />
      <ResizablePanel
        id={RIGHT_PANE}
        defaultSize="50%"
        minSize="26%"
        maxSize="75%"
        collapsible
        inert={collapsed}
      >
        <PanelCollapsedProvider value={collapsed}>
          <SessionPane tab={tab} onTabChange={onTabChange} />
        </PanelCollapsedProvider>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
