import { useCallback, useEffect, useState } from 'react'

import { ERightTab } from './right-tab'
import { type PaneLayout, recallPaneLayout, rememberPaneLayout } from './pane-layout-memory'
import { recallThreadPanel, rememberThreadPanel } from './thread-panel-memory'
import { useRightPanelCollapsed } from './right-panel-collapsed'

export type RightPanelState = {
  tab: ERightTab
  sheetOpen: boolean
  collapsed: boolean
  changesPath: string | undefined
  agentId: string | undefined
  contextPath: string | undefined
  filePath: string | undefined
  layout: PaneLayout | undefined
  rememberLayout: (layout: PaneLayout) => void
  setTab: (tab: ERightTab) => void
  setSheetOpen: (open: boolean) => void
  setCollapsed: (collapsed: boolean) => void
  toggleCollapsed: () => void
  openPanel: () => void
  openChanges: (path?: string) => void
  openAgent: (id: string) => void
  openDetails: () => void
  clearAgent: () => void
  openContextFile: (path: string) => void
  toggleContextFile: (path: string) => void
  closeContextFile: () => void
  openFile: (path: string) => void
  closeFile: () => void
}

export function useRightPanel(threadId: string): RightPanelState {
  const [remembered] = useState(() => recallThreadPanel(threadId))
  const [tab, setTab] = useState(remembered.tab ?? ERightTab.Details)
  const [layout] = useState(() => recallPaneLayout(threadId))
  const rememberLayout = useCallback(
    (next: PaneLayout) => rememberPaneLayout({ threadId, layout: next }),
    [threadId],
  )
  const [sheetOpen, setSheetOpen] = useState(false)
  const { collapsed, setCollapsed } = useRightPanelCollapsed()
  const [changesPath, setChangesPath] = useState<string | undefined>(undefined)
  const [agentId, setAgentId] = useState(remembered.agentId)
  const [contextPath, setContextPath] = useState(remembered.contextPath)
  const [filePath, setFilePath] = useState(remembered.filePath)
  useEffect(
    () =>
      rememberThreadPanel({
        threadId,
        patch: { tab, agentId, contextPath, filePath },
      }),
    [threadId, tab, agentId, contextPath, filePath],
  )

  const openPanel = useCallback(() => {
    setSheetOpen(true)
    setCollapsed(false)
  }, [setCollapsed])

  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed])

  const openChanges = useCallback(
    (path?: string) => {
      setChangesPath(path)
      setFilePath(undefined)
      setTab(ERightTab.Changes)
      openPanel()
    },
    [openPanel],
  )

  const openAgent = useCallback(
    (id: string) => {
      setAgentId(id)
      setTab(ERightTab.Details)
      openPanel()
    },
    [openPanel],
  )

  const openDetails = useCallback(() => {
    setTab(ERightTab.Details)
    openPanel()
  }, [openPanel])

  const clearAgent = useCallback(() => setAgentId(undefined), [])

  const openContextFile = useCallback((path: string) => {
    setContextPath(path)
    setFilePath(undefined)
    setSheetOpen(false)
  }, [])

  const toggleContextFile = useCallback((path: string) => {
    setContextPath((held) => (held === path ? undefined : path))
    setFilePath(undefined)
    setSheetOpen(false)
  }, [])

  const closeContextFile = useCallback(() => setContextPath(undefined), [])

  const openFile = useCallback((path: string) => {
    setFilePath(path)
    setContextPath(undefined)
    setSheetOpen(false)
  }, [])

  const closeFile = useCallback(() => setFilePath(undefined), [])

  return {
    tab,
    sheetOpen,
    collapsed,
    changesPath,
    agentId,
    contextPath,
    filePath,
    layout,
    rememberLayout,
    setTab,
    setSheetOpen,
    setCollapsed,
    toggleCollapsed,
    openPanel,
    openChanges,
    openAgent,
    openDetails,
    clearAgent,
    openContextFile,
    toggleContextFile,
    closeContextFile,
    openFile,
    closeFile,
  }
}
