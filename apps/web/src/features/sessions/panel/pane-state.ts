'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type PaneLayout,
  recallPaneLayout,
  rememberPaneLayout,
} from '@/features/threads/panel/pane-layout-memory'
import { samePaneLayout } from '@/features/threads/panel/pane-split'
import { useRightPanelCollapsed } from '@/features/threads/panel/right-panel-collapsed'

import {
  recallDetailsOpen,
  recallPaneTab,
  rememberDetailsOpen,
  rememberPaneTab,
} from './pane-memory'
import { EPaneOpen, type PaneOpenRequest } from './pane-open'
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
  openRequest: PaneOpenRequest | undefined
  requestOpen: (request: { kind: EPaneOpen; path: string }) => void
  consumeOpenRequest: (id: number) => void
  podSizeRequest: number
  requestPodSize: () => void
  consumePodSizeRequest: () => void
  layout: PaneLayout | undefined
  rememberLayout: (layout: PaneLayout) => void
  detailsOpen: boolean
  detailsShown: boolean
  setDetailsOpen: (open: boolean) => void
  toggleDetails: () => void
  openDetails: () => void
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
  const [detailsOpen, setDetailsOpenState] = useState(() => recallDetailsOpen(sessionId))
  const setDetailsOpen = useCallback(
    (open: boolean) => {
      rememberDetailsOpen({ sessionId, open })
      setDetailsOpenState(open)
    },
    [sessionId],
  )
  const [sheetOpen, setSheetOpen] = useState(false)
  const [openRequest, setOpenRequest] = useState<PaneOpenRequest | undefined>(undefined)
  const nextOpenId = useRef(0)
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

  const detailsShown = detailsOpen && collapsed
  const toggleDetails = useCallback(() => {
    if (detailsShown) return setDetailsOpen(false)
    setDetailsOpen(true)
    setCollapsed(true)
  }, [detailsShown, setDetailsOpen, setCollapsed])

  const openDetails = useCallback(() => {
    setDetailsOpen(true)
    setCollapsed(true)
    setTab(ESessionPaneTab.Details)
    setSheetOpen(true)
  }, [setDetailsOpen, setCollapsed])

  const openTab = useCallback(
    (next: ESessionPaneTab) => {
      setTab(next)
      openPane()
    },
    [openPane],
  )

  const requestOpen = useCallback(
    (request: { kind: EPaneOpen; path: string }) => {
      nextOpenId.current += 1
      setOpenRequest({ ...request, id: nextOpenId.current })
      setTab(request.kind === EPaneOpen.Changes ? ESessionPaneTab.Changes : ESessionPaneTab.Files)
      openPane()
    },
    [openPane],
  )

  const consumeOpenRequest = useCallback((id: number) => {
    setOpenRequest((held) => (held?.id === id ? undefined : held))
  }, [])

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
    openRequest,
    requestOpen,
    consumeOpenRequest,
    podSizeRequest,
    requestPodSize,
    consumePodSizeRequest,
    layout,
    rememberLayout,
    detailsOpen,
    detailsShown,
    setDetailsOpen,
    toggleDetails,
    openDetails,
  }
}
