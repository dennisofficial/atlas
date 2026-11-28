'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type PaneLayout,
  recallPaneLayout,
  rememberPaneLayout,
} from '@/features/threads/panel/pane-layout-memory'
import { samePaneLayout } from '@/features/threads/panel/pane-split'

import {
  recallCollapsed,
  recallCollapsedBeforeAgent,
  recallDetailsOpen,
  recallPaneTab,
  rememberCollapsed,
  rememberCollapsedBeforeAgent,
  rememberDetailsOpen,
  rememberPaneTab,
} from './pane-memory'
import { morphSessionDetails } from './details-morph'
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
  expandPane: (update: () => void) => void
  enterAgentPane: (update: () => void) => void
  revealAgentPane: () => void
  leaveAgentPane: (update: () => void) => void
  settleAgentPane: () => void
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
  const [collapsed, setCollapsedState] = useState(() => recallCollapsed(sessionId))
  const collapsedNow = useRef(collapsed)
  const setCollapsed = useCallback(
    (next: boolean) => {
      collapsedNow.current = next
      rememberCollapsed({ sessionId, collapsed: next })
      setCollapsedState(next)
    },
    [sessionId],
  )
  const collapsedBeforeAgent = useRef(recallCollapsedBeforeAgent(sessionId))
  const holdAgentReturn = useCallback(() => {
    if (collapsedBeforeAgent.current !== undefined) return
    collapsedBeforeAgent.current = collapsedNow.current
    rememberCollapsedBeforeAgent({ sessionId, collapsed: collapsedNow.current })
  }, [sessionId])
  const takeAgentReturn = useCallback(() => {
    const held = collapsedBeforeAgent.current
    collapsedBeforeAgent.current = undefined
    rememberCollapsedBeforeAgent({ sessionId, collapsed: undefined })
    return held
  }, [sessionId])
  useEffect(() => rememberPaneTab({ sessionId, tab }), [sessionId, tab])

  const expandPane = useCallback(
    (update: () => void) => {
      setSheetOpen(true)
      morphSessionDetails(() => {
        update()
        setCollapsed(false)
      })
    },
    [setCollapsed],
  )

  const openPane = useCallback(() => expandPane(() => undefined), [expandPane])

  const enterAgentPane = useCallback(
    (update: () => void) => {
      holdAgentReturn()
      expandPane(update)
    },
    [holdAgentReturn, expandPane],
  )

  const revealAgentPane = useCallback(() => {
    holdAgentReturn()
    setSheetOpen(true)
    setCollapsed(false)
  }, [holdAgentReturn, setCollapsed])

  const leaveAgentPane = useCallback(
    (update: () => void) => {
      const held = takeAgentReturn()
      morphSessionDetails(() => {
        update()
        if (held !== undefined) setCollapsed(held)
      })
    },
    [takeAgentReturn, setCollapsed],
  )

  const settleAgentPane = useCallback(() => {
    const held = takeAgentReturn()
    if (held !== undefined) setCollapsed(held)
  }, [takeAgentReturn, setCollapsed])

  const toggleCollapsed = useCallback(
    () => morphSessionDetails(() => setCollapsed(!collapsed)),
    [collapsed, setCollapsed],
  )

  const detailsShown = detailsOpen && collapsed
  const toggleDetails = useCallback(() => {
    if (detailsShown) return morphSessionDetails(() => setDetailsOpen(false))
    morphSessionDetails(() => {
      setDetailsOpen(true)
      setCollapsed(true)
    })
  }, [detailsShown, setDetailsOpen, setCollapsed])

  const openDetails = useCallback(() => {
    setTab(ESessionPaneTab.Details)
    setSheetOpen(true)
    morphSessionDetails(() => {
      setDetailsOpen(true)
      setCollapsed(true)
    })
  }, [setDetailsOpen, setCollapsed])

  const openTab = useCallback(
    (next: ESessionPaneTab) => expandPane(() => setTab(next)),
    [expandPane],
  )

  const requestOpen = useCallback(
    (request: { kind: EPaneOpen; path: string }) => {
      nextOpenId.current += 1
      const id = nextOpenId.current
      expandPane(() => {
        setOpenRequest({ ...request, id })
        setTab(request.kind === EPaneOpen.Changes ? ESessionPaneTab.Changes : ESessionPaneTab.Files)
      })
    },
    [expandPane],
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
    expandPane,
    enterAgentPane,
    revealAgentPane,
    leaveAgentPane,
    settleAgentPane,
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
