import React from 'react'

import type { RecoveredAgents } from '@dltech/atlas-harness'

import { AgentTypes } from '../ui/components/agent-types'
import { LostChildren } from '../ui/components/lost-children'
import { Screen } from '../ui/components/screen'
import { Shortcuts } from '../ui/components/shortcuts'
import { SelectionSurface } from '../ui/selection/selection-surface'
import { usePress } from '../ui/hooks/use-press'
import type { AtlasApp } from './compose'
import { EChromePanel } from './workspace-panels'

export function WorkspacePanel(props: {
  panel: EChromePanel | null
  width: number
  agentTypes: AtlasApp['agentTypes']
  lost: RecoveredAgents | null
}): React.ReactNode {
  if (props.panel === EChromePanel.Shortcuts) return <Shortcuts width={props.width} />
  if (props.panel === EChromePanel.AgentTypes) {
    return <AgentTypes width={props.width} catalog={props.agentTypes} />
  }
  if (props.panel === EChromePanel.LostAgents) {
    return <LostChildren width={props.width} lost={props.lost} />
  }
  return null
}

export function WorkspaceView(props: {
  header: React.ReactNode
  contentWidth: number
  transcript: React.ReactNode
  chrome: React.ReactNode
  sidebar: React.ReactNode
  overlays: React.ReactNode
  pane?: React.ReactNode
  onPaneFocus?: () => void
}): React.ReactNode {
  const press = usePress()
  return (
    <Screen {...(props.header === null ? {} : { header: props.header })}>
      <SelectionSurface>
        <box
          flexDirection="column"
          width={props.contentWidth}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          {...press(props.onPaneFocus)}
        >
          <box
            flexDirection="column"
            flexGrow={1}
            flexShrink={1}
            flexBasis={0}
            width={props.contentWidth}
            visible={props.pane == null}
            position={props.pane == null ? 'relative' : 'absolute'}
            top={0}
            bottom={0}
            left={0}
          >
            {props.transcript}
            {props.chrome}
          </box>
          {props.pane}
        </box>
        {props.sidebar}
        {props.overlays}
      </SelectionSurface>
    </Screen>
  )
}
