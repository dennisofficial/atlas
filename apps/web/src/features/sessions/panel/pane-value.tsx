'use client'

import { createContext, useContext } from 'react'

import type { SessionStatusOutput, SessionViewOutput } from '@dltech/atlas-protocol'

import type { SessionViewModel } from '../data/session-view-model'
import type { ESessionPaneTab } from './pane-tab'

export type SessionPaneValue = {
  sessionId: string
  title: string | undefined
  startedAt: string | undefined
  projectId: string | undefined
  view: SessionViewModel
  viewLoaded: boolean
  checkouts: SessionViewOutput['checkouts']
  status: SessionStatusOutput | undefined
  shellTails: Readonly<Record<string, string>>
  openTab: (tab: ESessionPaneTab) => void
  openBrowser: (url: string) => void
}

const SessionPaneContext = createContext<SessionPaneValue | null>(null)

export const SessionPaneProvider = SessionPaneContext.Provider

export function useSessionPaneValue(): SessionPaneValue {
  const value = useContext(SessionPaneContext)
  if (value === null) throw new Error('useSessionPaneValue needs a SessionPaneProvider')
  return value
}
