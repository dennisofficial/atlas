import React from 'react'

import { Footer } from '../ui/components/footer'
import { NoticeStack } from '../ui/components/notice-stack'
import type { NamingState } from '../ui/components/naming-line'
import type { DraftControls } from '../ui/hooks/use-draft'
import type { AtlasApp } from './compose'
import type { AgentView } from './use-agent-view'
import type { Conversation } from './use-conversation'
import type { useWorkspaceComposer } from './use-workspace-composer'
import type { WorkspaceFooter } from './use-workspace-footer'
import type { useViewedAgent } from './use-workspace-models'
import { WorkspaceComposer } from './workspace-composer'
import type { EChromePanel } from './workspace-panels'
import { WorkspacePanel } from './workspace-view'

export function WorkspaceChrome(props: {
  width: number
  composerWidth: number
  height: number
  welcome: boolean
  focused: boolean
  draft: DraftControls
  conversation: Pick<Conversation, 'working' | 'turn' | 'handle' | 'lost'>
  agentView: Pick<AgentView, 'addressing' | 'name'>
  composer: Pick<ReturnType<typeof useWorkspaceComposer>, 'menus' | 'highlights' | 'handleCursorMoved'>
  panel: EChromePanel | null
  agentTypes: AtlasApp['agentTypes']
  naming: NamingState | null
  footer: WorkspaceFooter
  readout: ReturnType<typeof useViewedAgent>['readout']
}): React.ReactNode {
  const { conversation, agentView, composer, footer } = props

  return (
    <>
      <NoticeStack width={props.width} />
      <WorkspacePanel
        panel={props.panel}
        width={props.width}
        agentTypes={props.agentTypes}
        lost={conversation.lost}
      />
      <WorkspaceComposer
        draft={props.draft}
        menus={composer.menus}
        width={props.composerWidth}
        height={props.height}
        welcome={props.welcome}
        focused={props.focused}
        working={conversation.working}
        interrupting={conversation.turn.interrupting}
        addressingChild={agentView.addressing !== null}
        highlights={composer.highlights}
        onCursorMoved={composer.handleCursorMoved}
        agentName={agentView.name}
        handle={conversation.handle}
        naming={props.naming}
      />
      <box flexGrow={props.welcome ? 1 : 0} flexShrink={1} />
      <Footer
        width={props.width}
        model={footer.footerModelLabel}
        layout={footer.footerRow}
        strip={footer.footerStrip.state}
        onActivateItem={footer.footerStrip.handleActivate}
        {...(props.readout === null ? {} : { context: props.readout })}
      />
    </>
  )
}
