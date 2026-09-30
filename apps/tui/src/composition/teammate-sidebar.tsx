import type { AgentSnapshot, ServiceSnapshot, ShellSnapshot } from '@dltech/atlas-harness'
import React from 'react'

import type { SidebarModel } from '../store/sidebar-model'
import type { SidebarCrewFold } from '../store/subagent-row'
import { Sidebar } from '../ui/components/sidebar'
import type { NamingState } from '../ui/components/naming-line'
import type { AtlasApp } from './compose'
import { useTeammateSidebar } from './use-teammate-scope'

/**
 * The teammate-scoped sidebar: the same panel fed by the model the caller already scoped to the
 * teammate — its own log fold merged with its own crew — with the head in the agent accent so the
 * takeover is visible at a glance. Shells and services stay the process-wide surfaces.
 */
export function TeammateSidebar(props: {
  app: AtlasApp
  teammate: AgentSnapshot
  /** The crew-bearing model `useAgents` scoped to this teammate. */
  crew: SidebarModel
  width: number
  root: string
  worktree: string | null
  version: string
  repoName?: string | undefined
  overlay?: boolean
  shells?: readonly ShellSnapshot[]
  shellNow?: number
  shellFold?: SidebarCrewFold
  services?: readonly ServiceSnapshot[]
  serviceNow?: number
  serviceFold?: SidebarCrewFold
  onOpenShell?: (shellId: string) => void
  onOpenService?: (serviceId: string) => void
  onSelectSubagent?: (agentId: string) => void
  naming?: NamingState | null | undefined
}): React.ReactNode {
  const sidebar = useTeammateSidebar({
    app: props.app,
    teammate: props.teammate,
    crew: props.crew,
  })

  return (
    <Sidebar
      width={props.width}
      model={sidebar}
      root={props.root}
      worktree={props.worktree}
      version={props.version}
      accented
      {...(props.repoName === undefined ? {} : { repoName: props.repoName })}
      {...(props.overlay === undefined ? {} : { overlay: props.overlay })}
      {...(props.shells === undefined ? {} : { shells: props.shells })}
      {...(props.shellNow === undefined ? {} : { shellNow: props.shellNow })}
      {...(props.shellFold === undefined ? {} : { shellFold: props.shellFold })}
      {...(props.services === undefined ? {} : { services: props.services })}
      {...(props.serviceNow === undefined ? {} : { serviceNow: props.serviceNow })}
      {...(props.serviceFold === undefined ? {} : { serviceFold: props.serviceFold })}
      {...(props.onOpenShell === undefined ? {} : { onOpenShell: props.onOpenShell })}
      {...(props.onOpenService === undefined ? {} : { onOpenService: props.onOpenService })}
      {...(props.onSelectSubagent === undefined
        ? {}
        : { onSelectSubagent: props.onSelectSubagent })}
      {...(props.naming === undefined || props.naming === null
        ? {}
        : { naming: props.naming })}
    />
  )
}
