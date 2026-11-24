import { useCallback, useEffect, useMemo, useState } from 'react'

import { EServiceStatus, EShellStatus } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import type { SidebarModel } from '../store/sidebar-model'
import type { SidebarSection } from '../ui/sidebar-section'
import { drawerServicesOf, serviceFoldOf, serviceRowsOf } from './drawer-services'
import type { PaneOwner } from './pane-keys'
import type { SessionApi } from './session-api'
import type { SessionPanes } from './session-view'
import { panesOfView } from './session-view'
import { sidebarModelOf } from './sidebar-model'
import { useCrew, useCrewNavigation, type CrewControl } from './use-crew'
import { useServicesDrawer, type ServicesDrawer } from './use-services-drawer'
import { useShellsDrawer, type ShellsDrawer } from './use-shells-drawer'
import type { SessionTranscript } from './use-session-transcript'

const TICK_MS = 1_000

const usePaneNow = (ticking: boolean): number => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!ticking) return

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  return now
}

export type SessionPanesControl = {
  panes: SessionPanes
  crew: CrewControl
  shells: ShellsDrawer
  services: ServicesDrawer
  sidebar: SidebarModel
  paneNow: number
  serviceFold: { hidden: number; hiddenFailed: boolean }
  owners: readonly PaneOwner[]
}

export function useSessionPanes(args: {
  transcript: SessionTranscript
  api: SessionApi
  sessionId: string
  teammates: readonly StreamSessionRow[]
  sections: readonly SidebarSection[]
  onOpenSession: (agentId: string) => void
  onStopAgent: (agentId: string) => void
  onKillShell: (shellId: string) => void
  onStopService: (serviceId: string) => void
  onRestartService: (serviceId: string) => void
  onProblem: (reason: string) => void
}): SessionPanesControl {
  const { sessionId, transcript } = args
  const at = transcript.view?.at

  const panes = useMemo(() => panesOfView(transcript.view), [at, transcript.view])

  const ticking =
    panes.shells.some((row) => row.status === EShellStatus.Running) ||
    panes.services.some((row) => row.status === EServiceStatus.Running)
  const paneNow = usePaneNow(ticking)

  const navigation = useCrewNavigation({ crew: panes.crew, sessionId })
  const crew = useCrew({
    crew: panes.crew,
    viewing: navigation.viewing,
    setViewing: navigation.setViewing,
    now: paneNow,
    onOpenSession: args.onOpenSession,
    onStop: args.onStopAgent,
    onProblem: args.onProblem,
  })

  const shells = useShellsDrawer({
    rows: panes.shells,
    sessionId,
    tails: transcript.shells,
    onKill: args.onKillShell,
  })

  const serviceViews = useMemo(() => drawerServicesOf(panes.services), [panes.services])
  const serviceRows = useMemo(
    () => serviceRowsOf({ services: serviceViews, previews: panes.previews }),
    [panes.previews, serviceViews],
  )
  const serviceFold = useMemo(() => serviceFoldOf(serviceViews), [serviceViews])
  const services = useServicesDrawer({
    rows: serviceRows,
    api: args.api,
    sessionId,
    headSeq: transcript.events.length,
    onStop: args.onStopService,
    onRestart: args.onRestartService,
  })

  const sidebar = useMemo(
    () =>
      sidebarModelOf({
        events: transcript.events,
        name: transcript.name,
        panes,
        crew: { rows: crew.rows, standings: crew.standings },
        teammates: args.teammates,
        sections: args.sections,
        now: paneNow,
      }),
    [
      args.sections,
      args.teammates,
      crew.rows,
      crew.standings,
      paneNow,
      panes,
      transcript.events,
      transcript.name,
    ],
  )

  const { handleKey: handleShellsKey } = shells
  const { handleKey: handleServicesKey } = services
  const shellsOpen = shells.open
  const servicesOpen = services.open

  const owners = useMemo<readonly PaneOwner[]>(
    () => [
      { isOpen: () => shellsOpen, handleKey: handleShellsKey },
      { isOpen: () => servicesOpen, handleKey: handleServicesKey },
    ],
    [handleServicesKey, handleShellsKey, servicesOpen, shellsOpen],
  )

  const handleToggleShells = useCallback(() => shells.handleToggle(), [shells])

  return useMemo(
    () => ({
      panes,
      crew,
      shells: { ...shells, handleToggle: handleToggleShells },
      services,
      sidebar,
      paneNow,
      owners,
      serviceFold,
    }),
    [crew, handleToggleShells, owners, paneNow, panes, serviceFold, services, shells, sidebar],
  )
}
