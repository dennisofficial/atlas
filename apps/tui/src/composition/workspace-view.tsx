import React from 'react'

import { Screen } from '../ui/components/screen'
import { Shortcuts } from '../ui/components/shortcuts'
import { SelectionSurface } from '../ui/selection/selection-surface'
import { EChromePanel } from './workspace-panels'

export function WorkspacePanel(props: {
  panel: EChromePanel | null
  width: number
}): React.ReactNode {
  if (props.panel === EChromePanel.Shortcuts) return <Shortcuts width={props.width} />
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
}): React.ReactNode {
  return (
    <Screen {...(props.header === null ? {} : { header: props.header })}>
      <SelectionSurface>
        <box
          flexDirection="column"
          width={props.contentWidth}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
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
