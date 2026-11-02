import { useCallback, useState } from 'react'

import { ERightTab } from './right-tab'

export type RightPanelState = {
  tab: ERightTab
  sheetOpen: boolean
  changesPath: string | undefined
  agentId: string | undefined
  contextPath: string | undefined
  filePath: string | undefined
  setTab: (tab: ERightTab) => void
  setSheetOpen: (open: boolean) => void
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

export function useRightPanel(): RightPanelState {
  const [tab, setTab] = useState(ERightTab.Details)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [changesPath, setChangesPath] = useState<string | undefined>(undefined)
  const [agentId, setAgentId] = useState<string | undefined>(undefined)

  const [contextPath, setContextPath] = useState<string | undefined>(undefined)

  const [filePath, setFilePath] = useState<string | undefined>(undefined)

  const openChanges = useCallback((path?: string) => {
    setChangesPath(path)
    setFilePath(undefined)
    setTab(ERightTab.Changes)
    setSheetOpen(true)
  }, [])

  const openAgent = useCallback((id: string) => {
    setAgentId(id)
    setTab(ERightTab.Details)
    setSheetOpen(true)
  }, [])

  const openDetails = useCallback(() => {
    setTab(ERightTab.Details)
    setSheetOpen(true)
  }, [])

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
    changesPath,
    agentId,
    contextPath,
    filePath,
    setTab,
    setSheetOpen,
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
