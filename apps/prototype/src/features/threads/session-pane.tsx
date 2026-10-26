import { useRouter } from 'next/navigation'
import { useMemo, useState, type ReactNode } from 'react'

import type { AgentsPanelTeammate } from '@dltech/atlas-ui/ai/agents-panel'
import { EConfirmationState } from '@dltech/atlas-ui/ai/confirmation'
import type { QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@dltech/atlas-ui/components/resizable'

import type { AppTeammate } from '../shell/fixtures/teammates'
import { teammateDisplay } from '../shell/teammate-display'
import { threadPath } from '../shell/thread-href'
import { toPanelAgent } from './agent-adapters'
import type { AgentRun } from './agent-run'
import type { PodPanelState } from './pod-state'
import { RightPanel } from './right-panel'
import type { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'
import { SessionHeader, type SessionHeaderProps } from './session-header'
import { ERightTab, ESessionState } from './session-types'
import { TeammateTranscript } from './teammate-transcript'
import { ThreadComposer } from './thread-composer'
import { planFor } from './transcript-data'
import { Transcript } from './transcript'
import { useSpawnFlash } from './use-spawn-flash'

export interface SessionPaneProps {
  state: ESessionState
  header: SessionHeaderProps
  agents: AgentRun[]
  teammates: AppTeammate[]
  openedTeammate?: AppTeammate
  initialTab: ERightTab
  initialDetailId?: string
  initialQueue: QueuedMessageEntry[]
  initialTerminalConnection?: ETerminalConnection
  initialPreviewId?: string
  pod?: PodPanelState
  renderTranscript?: (api: { onOpenFile: (path: string) => void }) => ReactNode
  composer?: ReactNode
}

function toPanelTeammate(teammate: AppTeammate): AgentsPanelTeammate {
  return { id: teammate.id, title: teammate.title, display: teammateDisplay(teammate) }
}

export function SessionPane({
  state,
  header,
  agents,
  teammates,
  openedTeammate,
  initialTab,
  initialDetailId,
  initialQueue,
  initialTerminalConnection,
  initialPreviewId,
  pod,
  renderTranscript,
  composer,
}: SessionPaneProps) {
  const router = useRouter()
  const [tab, setTab] = useState(initialTab)
  const [detailId, setDetailId] = useState(initialDetailId)
  const [expanded, setExpanded] = useState<string[]>([])
  const [approval, setApproval] = useState(EConfirmationState.Pending)
  const { flashId, flash } = useSpawnFlash()
  const panelAgents = useMemo(() => agents.map(toPanelAgent), [agents])
  const busy = state === ESessionState.Running

  const handleOpenFile = (path: string) => {
    setTab(ERightTab.Changes)
    setExpanded((previous) => (previous.includes(path) ? previous : [...previous, path]))
  }

  const handleOpenTeammate = (id: string) => router.push(threadPath(id))

  const handleOpenAgent = (id: string) => {
    setTab(ERightTab.Agents)
    setDetailId(id)
  }

  const renderMain = () => {
    if (openedTeammate) return <TeammateTranscript teammate={openedTeammate} />
    if (renderTranscript) return renderTranscript({ onOpenFile: handleOpenFile })
    return (
      <Transcript
        state={state}
        approval={approval}
        onApprove={() => setApproval(EConfirmationState.Approved)}
        onDeny={() => setApproval(EConfirmationState.Denied)}
        onOpenFile={handleOpenFile}
        agents={agents}
        flashId={flashId}
        onOpenAgent={handleOpenAgent}
      />
    )
  }

  return (
    <>
      <SessionHeader {...header} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="transcript" minSize="35%">
          <div className="flex h-full min-w-0 flex-col">
            {renderMain()}
            {composer ?? (
              <ThreadComposer
                steps={openedTeammate ? [] : planFor(state)}
                initialQueue={initialQueue}
                busy={busy}
              />
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="right-panel" defaultSize="40%" minSize="26%" maxSize="60%">
          <RightPanel
            tab={tab}
            onTabChange={setTab}
            expanded={expanded}
            onExpandedChange={setExpanded}
            initialTerminalConnection={initialTerminalConnection}
            initialPreviewId={initialPreviewId}
            pod={pod}
            agents={panelAgents}
            teammates={teammates.map(toPanelTeammate)}
            detailId={detailId}
            onDetailChange={setDetailId}
            onOpenTeammate={handleOpenTeammate}
            onJumpToSpawn={flash}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  )
}
