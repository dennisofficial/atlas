'use client'

import { useCallback, useMemo } from 'react'

import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import type { SessionViewOutput } from '@dltech/atlas-protocol'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { type SessionViewModel, shellTailTextOf } from '../data/session-view-model'
import { openBrowserUrl } from './browser/open-browser'
import { ESessionPaneTab } from './pane-tab'
import type { SessionPaneValue } from './pane-value'
import { previewPortsOf } from './preview-ports'
import { enteredWorktreePathOf } from '../data/entered-worktree'

export type PaneSnapshot = Pick<SessionSnapshot, 'view' | 'status' | 'shells' | 'events'>

const NO_CHECKOUTS: SessionViewOutput['checkouts'] = { repos: [], primary: null }

export type SessionPaneWiring = {
  paneValue: SessionPaneValue
  ports: PreviewPort[]
  shellTails: Readonly<Record<string, string>>
  openBrowser: (url: string) => void
  openBrowserTab: () => void
}

export function useSessionPaneWiring(args: {
  sessionId: string
  title: string | undefined
  startedAt: string | undefined
  projectId: string | undefined
  model: SessionViewModel
  snapshot: PaneSnapshot
  mainThreadId: string | undefined
  openTab: (tab: ESessionPaneTab) => void
}): SessionPaneWiring {
  const { sessionId, title, startedAt, projectId, model, snapshot, mainThreadId, openTab } = args
  const { view: viewOutput, status, shells, events } = snapshot
  const threadWorktreePath = useMemo(
    () =>
      mainThreadId === undefined
        ? undefined
        : enteredWorktreePathOf({ events, threadId: mainThreadId }),
    [mainThreadId, events],
  )
  const shellTails = useMemo(() => shellTailTextOf(shells), [shells])
  const ports = useMemo(() => previewPortsOf(model.previews), [model.previews])
  const openBrowserTab = useCallback(() => openTab(ESessionPaneTab.Browser), [openTab])
  const openBrowser = useCallback(
    (url: string) => {
      openBrowserUrl({ sessionId, url, ports })
      openBrowserTab()
    },
    [sessionId, ports, openBrowserTab],
  )
  const paneValue = useMemo<SessionPaneValue>(
    () => ({
      sessionId,
      title,
      startedAt,
      projectId,
      view: model,
      viewLoaded: viewOutput !== undefined,
      checkouts: viewOutput?.checkouts ?? NO_CHECKOUTS,
      threadWorktreePath,
      status,
      shellTails,
      openTab,
      openBrowser,
    }),
    [
      sessionId,
      title,
      startedAt,
      projectId,
      model,
      viewOutput,
      threadWorktreePath,
      status,
      shellTails,
      openTab,
      openBrowser,
    ],
  )
  return { paneValue, ports, shellTails, openBrowser, openBrowserTab }
}
