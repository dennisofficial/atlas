'use client'

import type { PodStatus } from '@dltech/atlas-wire/web'

import { isPodFailed } from './data/boot-view'
import { headerStateOf } from './data/header-model'
import type { useThreadNaming } from './data/use-thread-naming'
import type { RightPanelState } from './panel/use-right-panel'
import { ThreadHeader } from './thread-header'

export function ThreadViewHeader(props: {
  naming: ReturnType<typeof useThreadNaming>
  pod: PodStatus | null
  working: boolean
  waitingOnOperator: boolean
  spawnerId: string | undefined
  parentTitle: string | null
  local: boolean
  rightPanel: RightPanelState
}) {
  const { rightPanel } = props
  return (
    <ThreadHeader
      title={props.naming.headerTitle}
      naming={props.naming.naming}
      state={headerStateOf({
        failed: isPodFailed(props.pod),
        working: props.working,
        waitingOnOperator: props.waitingOnOperator,
      })}
      parent={
        props.spawnerId === undefined
          ? undefined
          : { id: props.spawnerId, title: props.parentTitle }
      }
      local={props.local}
      panelCollapsed={rightPanel.collapsed}
      onOpenPanel={rightPanel.openPanel}
      onTogglePanel={rightPanel.toggleCollapsed}
    />
  )
}
