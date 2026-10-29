import { useCallback, useState } from 'react'

import { ERightTab } from './right-tab'

export type RightPanelState = {
  tab: ERightTab
  sheetOpen: boolean
  changesPath: string | undefined
  agentId: string | undefined
  contextPath: string | undefined
  setTab: (tab: ERightTab) => void
  setSheetOpen: (open: boolean) => void
  openChanges: (path?: string) => void
  openAgent: (id: string) => void
  openDetails: () => void
  clearAgent: () => void
  openContextFile: (path: string) => void
  toggleContextFile: (path: string) => void
  closeContextFile: () => void
}

export function useRightPanel(): RightPanelState {
  const [tab, setTab] = useState(ERightTab.Details)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [changesPath, setChangesPath] = useState<string | undefined>(undefined)
  const [agentId, setAgentId] = useState<string | undefined>(undefined)

  const [contextPath, setContextPath] = useState<string | undefined>(undefined)

  const openChanges = useCallback((path?: string) => {
    setChangesPath(path)
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
    setSheetOpen(false)
  }, [])

  const toggleContextFile = useCallback((path: string) => {
    setContextPath((held) => (held === path ? undefined : path))
    setSheetOpen(false)
  }, [])

  const closeContextFile = useCallback(() => setContextPath(undefined), [])

  return {
    tab,
    sheetOpen,
    changesPath,
    agentId,
    contextPath,
    setTab,
    setSheetOpen,
    openChanges,
    openAgent,
    openDetails,
    clearAgent,
    openContextFile,
    toggleContextFile,
    closeContextFile,
  }
}
