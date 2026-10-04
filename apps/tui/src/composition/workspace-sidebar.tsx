import React from 'react'

import type { SidebarModel } from '../store/sidebar-model'
import { versionLabel } from '../build/info'
import type { NamingState } from '../ui/components/naming-line'
import { Sidebar } from '../ui/components/sidebar'
import { floatingSidebarWidth } from '../ui/sidebar-visibility'
import type { AtlasApp } from './compose'
import { TeammateSidebar } from './teammate-sidebar'
import type { AgentView } from './use-agent-view'
import type { ContextControl } from './use-context'
import type { Conversation } from './use-conversation'
import type { ServicesControl } from './use-services'
import type { ShellsControl } from './use-shells'

export function WorkspaceSidebar(props: {
  app: AtlasApp
  width: number
  sidebarWidth: number
  overlay: boolean
  model: SidebarModel
  crew: SidebarModel
  naming: NamingState | null
  root: string
  repoName: string
  worktree: string | null
  scopedRepo: string | null
  scopedWorktree: string | null
  shells: Pick<ShellsControl, 'folded' | 'now' | 'fold' | 'handleOpen'>
  services: Pick<ServicesControl, 'folded' | 'now' | 'fold' | 'handleOpen'>
  agentView: Pick<AgentView, 'scopedTo' | 'backLabel' | 'handleBack' | 'handleSelect'>
  contextBrowser: Pick<ContextControl, 'tree'>
  onRevokeGrant: Conversation['handleRevokeGrant']
}): React.ReactNode {
  const { agentView, shells, services, naming, overlay, contextBrowser } = props
  const tree = contextBrowser.tree
  const context = { rows: tree.rows, levels: tree.levels, cursor: tree.cursor, opened: tree.opened,
    focused: tree.focused, loading: tree.loading, onFocus: tree.handleFocus, onActivate: tree.handleActivate }
  const width = overlay
    ? floatingSidebarWidth({ width: props.width, sidebarWidth: props.sidebarWidth })
    : props.sidebarWidth
  const back =
    agentView.backLabel === null
      ? undefined
      : { label: agentView.backLabel, onBack: agentView.handleBack }

  if (agentView.scopedTo !== null) {
    return (
      <TeammateSidebar
        app={props.app}
        teammate={agentView.scopedTo}
        crew={props.crew}
        back={back}
        width={width}
        root={props.scopedRepo ?? props.root}
        repoName={props.repoName}
        worktree={props.scopedWorktree}
        version={versionLabel()}
        overlay={overlay}
        shells={shells.folded}
        shellNow={shells.now}
        shellFold={shells.fold}
        services={services.folded}
        serviceNow={services.now}
        serviceFold={services.fold}
        onOpenShell={shells.handleOpen}
        onOpenService={services.handleOpen}
        onSelectSubagent={agentView.handleSelect}
        context={context}
      />
    )
  }

  return (
    <Sidebar
      width={width}
      model={props.model}
      {...(naming === null ? {} : { naming })}
      root={props.root}
      repoName={props.repoName}
      worktree={props.worktree}
      version={versionLabel()}
      overlay={overlay}
      shells={shells.folded}
      shellNow={shells.now}
      shellFold={shells.fold}
      services={services.folded}
      serviceNow={services.now}
      serviceFold={services.fold}
      onOpenShell={shells.handleOpen}
      onOpenService={services.handleOpen}
      onSelectSubagent={agentView.handleSelect}
      context={context}
      onRevokeGrant={props.onRevokeGrant}
      {...(back === undefined ? {} : { back })}
    />
  )
}
