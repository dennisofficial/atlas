import { useState, type ReactNode } from 'react'

import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'
import type { QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'

import { findThread, SESSION_THREAD_ID } from '../../../fixtures/app'
import { findTeammate, teammatesOf } from '../../../fixtures/teammates'
import { AppShell, type AppShellProps } from '../../shell/app-shell'
import { agentsFor } from './agent-fixtures'
import type { ETerminalConnection } from './sandbox-terminal'
import type { PodPanelState } from './pod-state'
import { INITIAL_QUEUE } from './queue-fixtures'
import type { SessionHeaderProps } from './session-header'
import { SessionPane } from './session-pane'
import { ERightTab, ESessionState } from './session-types'
import { teammateHeader, teammateSessionState } from './teammate-view'

export interface SessionViewProps {
  state?: ESessionState
  initialTab?: ERightTab
  initialDetailId?: string
  initialQueue?: QueuedMessageEntry[]
  initialTerminalConnection?: ETerminalConnection
  initialPreviewId?: string
  header?: Pick<SessionHeaderProps, 'title' | 'subtitle' | 'detail' | 'badgeLabel' | 'podStatus'>
  shell?: Pick<AppShellProps, 'activeThreadId' | 'pendingThread'>
  pod?: PodPanelState
  renderTranscript?: (api: { onOpenFile: (path: string) => void }) => ReactNode
  composer?: ReactNode
}

export function SessionView({
  state = ESessionState.Running,
  initialTab = ERightTab.Agents,
  initialDetailId,
  initialQueue,
  initialTerminalConnection,
  initialPreviewId,
  header,
  shell,
  pod,
  renderTranscript,
  composer,
}: SessionViewProps) {
  const [openId, setOpenId] = useState(shell?.activeThreadId ?? SESSION_THREAD_ID)
  const teammate = findTeammate(openId)
  const navigable = renderTranscript === undefined

  const handleOpenThread = (threadId: string) => {
    if (!navigable) return
    if (threadId === SESSION_THREAD_ID || findTeammate(threadId)) setOpenId(threadId)
  }
  const handleOpenParent = () => handleOpenThread(SESSION_THREAD_ID)

  const paneState = teammate ? teammateSessionState(teammate) : state
  const paneHeader: SessionHeaderProps = teammate
    ? teammateHeader({
        teammate,
        parentTitle: findThread(teammate.parentId).title,
        onOpenParent: handleOpenParent,
      })
    : { state, ...header }
  const isMain = !teammate && navigable

  return (
    <TooltipProvider>
      <AppShell
        activeThreadId={openId}
        pendingThread={shell?.pendingThread}
        onOpenThread={handleOpenThread}
      >
        <SessionPane
          key={openId}
          state={paneState}
          header={paneHeader}
          agents={isMain ? agentsFor(state) : []}
          teammates={isMain ? teammatesOf(SESSION_THREAD_ID) : []}
          openedTeammate={teammate}
          initialTab={initialTab}
          initialDetailId={initialDetailId}
          initialQueue={initialQueue ?? (teammate ? [] : INITIAL_QUEUE[state])}
          initialTerminalConnection={initialTerminalConnection}
          initialPreviewId={initialPreviewId}
          pod={pod}
          renderTranscript={renderTranscript}
          composer={composer}
          onOpenThread={handleOpenThread}
        />
      </AppShell>
    </TooltipProvider>
  )
}
