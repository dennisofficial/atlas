'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  type PaneLayout,
  recallPaneLayout,
  rememberPaneLayout,
} from '@/features/threads/panel/pane-layout-memory'
import { samePaneLayout } from '@/features/threads/panel/pane-split'
import { useRightPanelCollapsed } from '@/features/threads/panel/right-panel-collapsed'

import { recallPaneTab, rememberPaneTab } from './pane-memory'
import { ESessionPaneTab } from './pane-tab'

export type SessionPaneState = {
  tab: ESessionPaneTab
  setTab: (tab: ESessionPaneTab) => void
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggleCollapsed: () => void
  openPane: () => void
  openTab: (tab: ESessionPaneTab) => void
  podSizeRequest: number
  requestPodSize: () => void
  consumePodSizeRequest: () => void
  layout: PaneLayout | undefined
  rememberLayout: (layout: PaneLayout) => void
}

export function useSessionPane(sessionId: string): SessionPaneState {
  const [tab, setTab] = useState<ESessionPaneTab>(
    () => recallPaneTab(sessionId) ?? ESessionPaneTab.Details,
  )
  const [layout, setLayout] = useState(() => recallPaneLayout(sessionId))
  const rememberLayout = useCallback(
    (next: PaneLayout) => {
      rememberPaneLayout({ threadId: sessionId, layout: next })
      setLayout((held) => (samePaneLayout(held, next) ? held : next))
    },
    [sessionId],
  )
  const [sheetOpen, setSheetOpen] = useState(false)
  const [podSizeRequest, setPodSizeRequest] = useState(0)
  const requestPodSize = useCallback(() => setPodSizeRequest((count) => count + 1), [])
  const consumePodSizeRequest = useCallback(() => setPodSizeRequest(0), [])
  const { collapsed, setCollapsed } = useRightPanelCollapsed()
  useEffect(() => rememberPaneTab({ sessionId, tab }), [sessionId, tab])

  const openPane = useCallback(() => {
    setSheetOpen(true)
    setCollapsed(false)
  }, [setCollapsed])

  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed])

  const openTab = useCallback(
    (next: ESessionPaneTab) => {
      setTab(next)
      openPane()
    },
    [openPane],
  )

  return {
    tab,
    setTab,
    sheetOpen,
    setSheetOpen,
    collapsed,
    setCollapsed,
    toggleCollapsed,
    openPane,
    openTab,
    podSizeRequest,
    requestPodSize,
    consumePodSizeRequest,
    layout,
    rememberLayout,
  }
}
