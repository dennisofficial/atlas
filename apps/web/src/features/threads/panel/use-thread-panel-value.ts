'use client'

import { useCallback, useMemo } from 'react'

import type { PodStatus } from '@dltech/atlas-wire/web'

import type { ServeChannel } from '../data/live-thread-view'
import type { ThreadPanelValue } from './thread-panel-context'
import type { RightPanelState } from './use-right-panel'

export function useThreadPanelValue(args: {
  threadId: string
  channel: ServeChannel | null
  pod: PodStatus | null
  working: boolean
  rightPanel: RightPanelState
  refresh: () => void
}): ThreadPanelValue {
  const { threadId, channel, pod, working, rightPanel, refresh } = args
  const { changesPath, agentId, openChanges, openAgent, clearAgent, setSheetOpen } = rightPanel
  const closePanel = useCallback(() => setSheetOpen(false), [setSheetOpen])

  return useMemo<ThreadPanelValue>(
    () => ({
      threadId,
      channel,
      pod,
      working,
      changesPath,
      agentId,
      openChanges,
      openAgent,
      clearAgent,
      closePanel,
      refreshPod: refresh,
    }),
    [
      threadId,
      channel,
      pod,
      working,
      changesPath,
      agentId,
      openChanges,
      openAgent,
      clearAgent,
      closePanel,
      refresh,
    ],
  )
}
