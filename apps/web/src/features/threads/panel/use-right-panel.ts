import { useCallback, useState } from 'react'

import { ERightTab } from './right-tab'

export type RightPanelState = {
  tab: ERightTab
  sheetOpen: boolean
  changesPath: string | undefined
  setTab: (tab: ERightTab) => void
  setSheetOpen: (open: boolean) => void
  openChanges: (path?: string) => void
}

export function useRightPanel(): RightPanelState {
  const [tab, setTab] = useState(ERightTab.Agents)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [changesPath, setChangesPath] = useState<string | undefined>(undefined)

  const openChanges = useCallback((path?: string) => {
    setChangesPath(path)
    setTab(ERightTab.Changes)
    setSheetOpen(true)
  }, [])

  return { tab, sheetOpen, changesPath, setTab, setSheetOpen, openChanges }
}
