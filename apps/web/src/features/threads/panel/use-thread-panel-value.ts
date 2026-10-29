'use client'

import { useCallback, useMemo } from 'react'

import type { PodStatus } from '@dltech/atlas-wire/web'

import type { DetailsInput } from './details/details-input'
import type { ServeChannel } from '../data/live-thread-view'
import type { ThreadPanelValue } from './thread-panel-context'
import type { RightPanelState } from './use-right-panel'

export function useThreadPanelValue(args: {
  threadId: string
  channel: ServeChannel | null
  pod: PodStatus | null
  details: DetailsInput
  working: boolean
  rightPanel: RightPanelState
  refresh: () => void
}): ThreadPanelValue {
  const { threadId, channel, pod, details, working, rightPanel, refresh } = args
  const {
    changesPath,
    agentId,
    contextPath,
    openChanges,
    openAgent,
    openDetails,
    clearAgent,
    openContextFile,
    toggleContextFile,
    closeContextFile,
    setSheetOpen,
  } = rightPanel
  const closePanel = useCallback(() => setSheetOpen(false), [setSheetOpen])

  return useMemo<ThreadPanelValue>(
    () => ({
      threadId,
      channel,
      pod,
      details,
      working,
      changesPath,
      agentId,
      contextPath,
      openChanges,
      openAgent,
      openDetails,
      clearAgent,
      openContextFile,
      toggleContextFile,
      closeContextFile,
      closePanel,
      refreshPod: refresh,
    }),
    [
      threadId,
      channel,
      pod,
      details,
      working,
      changesPath,
      agentId,
      contextPath,
      openChanges,
      openAgent,
      openDetails,
      clearAgent,
      openContextFile,
      toggleContextFile,
      closeContextFile,
      closePanel,
      refresh,
    ],
  )
}
