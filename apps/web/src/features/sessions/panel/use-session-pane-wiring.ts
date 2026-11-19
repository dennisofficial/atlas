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

export type PaneSnapshot = Pick<SessionSnapshot, 'view' | 'status' | 'shells'>

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
  model: SessionViewModel
  snapshot: PaneSnapshot
  openTab: (tab: ESessionPaneTab) => void
}): SessionPaneWiring {
  const { sessionId, title, startedAt, model, snapshot, openTab } = args
  const { view: viewOutput, status, shells } = snapshot
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
      view: model,
      viewLoaded: viewOutput !== undefined,
      checkouts: viewOutput?.checkouts ?? NO_CHECKOUTS,
      status,
      shellTails,
      openTab,
      openBrowser,
    }),
    [sessionId, title, startedAt, model, viewOutput, status, shellTails, openTab, openBrowser],
  )
  return { paneValue, ports, shellTails, openBrowser, openBrowserTab }
}
