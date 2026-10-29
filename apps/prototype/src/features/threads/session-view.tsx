import type { ReactNode } from 'react'

import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'
import type { QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'

import { findThread, SESSION_THREAD_ID } from '../shell/fixtures/app'
import { findTeammate, teammatesOf } from '../shell/fixtures/teammates'
import { threadPath } from '../shell/thread-href'
import { agentsFor } from './agent-fixtures'
import type { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'
import type { PodPanelState } from './pod-state'
import type { SessionHeaderProps } from './session-header'
import { SessionPane } from './session-pane'
import { ERightTab, ESessionState } from './session-types'
import { teammateHeader, teammateSessionState } from './teammate-view'

export interface SessionViewProps {
  threadId?: string
  state?: ESessionState
  initialTab?: ERightTab
  initialDetailId?: string
  initialQueue?: QueuedMessageEntry[]
  initialTerminalConnection?: ETerminalConnection
  initialPreviewId?: string
  header?: Pick<
    SessionHeaderProps,
    'title' | 'subtitle' | 'detail' | 'badgeLabel' | 'podStatus' | 'pullRequests'
  >
  pod?: PodPanelState
  renderTranscript?: (api: { onOpenFile: (path: string) => void }) => ReactNode
  composer?: ReactNode
}

export function SessionView({
  threadId = SESSION_THREAD_ID,
  state = ESessionState.Running,
  initialTab = ERightTab.Agents,
  initialDetailId,
  initialQueue = [],
  initialTerminalConnection,
  initialPreviewId,
  header,
  pod,
  renderTranscript,
  composer,
}: SessionViewProps) {
  const teammate = renderTranscript === undefined ? findTeammate(threadId) : undefined
  const isMain = !teammate && renderTranscript === undefined

  const paneState = teammate ? teammateSessionState(teammate) : state
  const paneHeader: SessionHeaderProps = teammate
    ? teammateHeader({
        teammate,
        parentTitle: findThread(teammate.parentId).title,
        parentHref: threadPath(teammate.parentId),
      })
    : { state, ...header }

  return (
    <TooltipProvider>
      <SessionPane
        key={threadId}
        state={paneState}
        header={paneHeader}
        agents={isMain && threadId === SESSION_THREAD_ID ? agentsFor(state) : []}
        teammates={isMain ? teammatesOf(threadId) : []}
        openedTeammate={teammate}
        initialTab={initialTab}
        initialDetailId={initialDetailId}
        initialQueue={teammate ? [] : initialQueue}
        initialTerminalConnection={initialTerminalConnection}
        initialPreviewId={initialPreviewId}
        pod={pod}
        renderTranscript={renderTranscript}
        composer={composer}
      />
    </TooltipProvider>
  )
}
