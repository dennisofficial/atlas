'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { ThreadPanelValue } from '@/features/threads/panel/thread-panel-context'

import { useSessionAgent } from '../agents/use-session-agent'
import { useSessionPane, type SessionPaneState } from '../panel/pane-state'
import { panelValueOf } from './panel-value'

export type SessionAgentWiring = {
  pane: SessionPaneState
  panel: ThreadPanelValue
  openAgent: (agentId: string, parentAgentId?: string) => void
  sheetOpenChange: (open: boolean) => void
}

export function useSessionAgentWiring(args: {
  sessionId: string
  working: boolean
}): SessionAgentWiring {
  const { sessionId, working } = args
  const pane = useSessionPane(sessionId)
  const { agentId, parentAgentId, openAgent, clearAgent } = useSessionAgent({
    openPane: pane.openPane,
  })
  const { openPane, setSheetOpen } = pane
  const openedFor = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (agentId !== undefined) {
      openedFor.current = agentId
      openPane()
      return
    }
    if (openedFor.current === undefined) return
    openedFor.current = undefined
    setSheetOpen(false)
  }, [agentId, openPane, setSheetOpen])

  const sheetOpenChange = useCallback(
    (open: boolean) => {
      setSheetOpen(open)
      if (!open) clearAgent()
    },
    [setSheetOpen, clearAgent],
  )

  const panel = useMemo(
    () =>
      panelValueOf({
        sessionId,
        working,
        agentId,
        parentAgentId,
        openAgent,
        clearAgent,
        openTab: pane.openTab,
        requestOpen: pane.requestOpen,
      }),
    [
      sessionId,
      working,
      agentId,
      parentAgentId,
      openAgent,
      clearAgent,
      pane.openTab,
      pane.requestOpen,
    ],
  )
  return { pane, panel, openAgent, sheetOpenChange }
}
