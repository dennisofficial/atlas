import { useCallback, useState } from 'react'

import { ERightTab } from './right-tab'

export type RightPanelState = {
  tab: ERightTab
  sheetOpen: boolean
  changesPath: string | undefined
  agentId: string | undefined
  setTab: (tab: ERightTab) => void
  setSheetOpen: (open: boolean) => void
  openChanges: (path?: string) => void
  openAgent: (id: string) => void
  clearAgent: () => void
}

export function useRightPanel(): RightPanelState {
  const [tab, setTab] = useState(ERightTab.Agents)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [changesPath, setChangesPath] = useState<string | undefined>(undefined)
  const [agentId, setAgentId] = useState<string | undefined>(undefined)

  const openChanges = useCallback((path?: string) => {
    setChangesPath(path)
    setTab(ERightTab.Changes)
    setSheetOpen(true)
  }, [])

  const openAgent = useCallback((id: string) => {
    setAgentId(id)
    setTab(ERightTab.Agents)
    setSheetOpen(true)
  }, [])

  const clearAgent = useCallback(() => setAgentId(undefined), [])

  return {
    tab,
    sheetOpen,
    changesPath,
    agentId,
    setTab,
    setSheetOpen,
    openChanges,
    openAgent,
    clearAgent,
  }
}
