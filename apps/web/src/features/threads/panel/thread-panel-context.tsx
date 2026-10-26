'use client'

import { createContext, useContext } from 'react'

import type { PodStatus } from '@dltech/atlas-wire/web'

import type { ServeChannel } from '../data/live-thread-view'

export type ThreadPanelValue = {
  threadId: string
  channel: ServeChannel | null
  pod: PodStatus | null
  working: boolean
  changesPath: string | undefined
  agentId: string | undefined
  openChanges: (path?: string) => void
  openAgent: (id: string) => void
  clearAgent: () => void
}

const ThreadPanelContext = createContext<ThreadPanelValue | null>(null)

export const ThreadPanelProvider = ThreadPanelContext.Provider

export function useThreadPanel(): ThreadPanelValue {
  const value = useContext(ThreadPanelContext)
  if (value === null) throw new Error('useThreadPanel must be used inside a ThreadPanelProvider')
  return value
}
