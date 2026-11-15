'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useGroupRef,
} from '@dltech/atlas-ui/components/resizable'

import type { PaneLayout } from './panel/pane-layout-memory'
import {
  COLLAPSED_PANE_LAYOUT,
  layoutForCollapse,
  paneCommitOf,
  RIGHT_PANE,
  TRANSCRIPT_PANE,
} from './panel/pane-split'
import { RightPanel } from './panel/right-panel'
import type { ERightTab } from './panel/right-tab'

export type ThreadSplitProps = {
  children: ReactNode
  tab: ERightTab
  onTabChange: (tab: ERightTab) => void
  layout: PaneLayout | undefined
  onLayoutChange: (layout: PaneLayout) => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function ThreadSplit(props: ThreadSplitProps) {
  const { children, tab, onTabChange, layout, onLayoutChange, collapsed, onCollapsedChange } = props
  const groupRef = useGroupRef()
  const expandedRef = useRef(layout)
  const [initialLayout] = useState<PaneLayout | undefined>(() =>
    collapsed ? COLLAPSED_PANE_LAYOUT : layout,
  )

  useEffect(() => {
    const group = groupRef.current
    if (group === null) return
    const next = layoutForCollapse({
      current: group.getLayout(),
      collapsed,
      expanded: expandedRef.current,
    })
    if (next) group.setLayout(next)
  }, [collapsed, groupRef])

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
        <RightPanel tab={tab} onTabChange={onTabChange} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
