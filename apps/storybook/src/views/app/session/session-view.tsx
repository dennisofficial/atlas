import { useRef, useState, type ComponentProps, type ReactNode } from 'react'

import { EConfirmationState } from '@dltech/atlas-ui/ai/confirmation'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@dltech/atlas-ui/components/resizable'
import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'

import { SESSION_THREAD_ID } from '../../../fixtures/app'
import { AppShell, type AppShellProps } from '../app-shell'
import { Composer } from './composer'
import type { ETerminalConnection } from './sandbox-terminal'
import { RightPanel } from './right-panel'
import type { PodPanelState } from './pod-state'
import { SessionHeader, type SessionHeaderProps } from './session-header'
import { ERightTab, ESessionState } from './session-types'
import { INITIAL_QUEUE, planFor } from './transcript-data'
import { Transcript } from './transcript'

type PanelRefProp = NonNullable<ComponentProps<typeof ResizablePanel>['panelRef']>
type PanelHandle = Extract<PanelRefProp, { current: unknown }>['current']

export interface SessionViewProps {
  state?: ESessionState
  initialTab?: ERightTab
  initialPanelOpen?: boolean
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
  initialTab = ERightTab.Changes,
  initialPanelOpen = true,
  initialTerminalConnection,
  initialPreviewId,
  header,
  shell,
  pod,
  renderTranscript,
  composer,
}: SessionViewProps) {
  const panelRef = useRef<PanelHandle>(null)
  const [panelOpen, setPanelOpen] = useState(initialPanelOpen)
  const [tab, setTab] = useState(initialTab)
  const [expanded, setExpanded] = useState<string[]>([])
  const [approval, setApproval] = useState(EConfirmationState.Pending)
  const [queued, setQueued] = useState(INITIAL_QUEUE[state])
  const busy = state === ESessionState.Running

  const handleTogglePanel = () => {
    if (panelOpen) panelRef.current?.collapse()
    else panelRef.current?.expand()
  }

  const handlePanelResize = (size: { asPercentage: number }) => setPanelOpen(size.asPercentage > 0)

  const handleOpenFile = (path: string) => {
    setTab(ERightTab.Changes)
    setExpanded((previous) => (previous.includes(path) ? previous : [...previous, path]))
    if (panelRef.current?.isCollapsed()) panelRef.current.expand()
  }

  const handleRemoveQueued = (id: string) =>
    setQueued((previous) => previous.filter((message) => message.id !== id))

  const handleSend = (text: string) => {
    if (!busy) return
    setQueued((previous) => [...previous, { id: `q-${previous.length + 1}-${text.length}`, text }])
  }

  return (
    <TooltipProvider>
      <AppShell
        activeThreadId={shell?.activeThreadId ?? SESSION_THREAD_ID}
        pendingThread={shell?.pendingThread}
      >
        <SessionHeader
          state={state}
          {...header}
          panelOpen={panelOpen}
          onTogglePanel={handleTogglePanel}
        />
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="transcript" minSize="35%">
            <div className="flex h-full min-w-0 flex-col">
              {renderTranscript ? (
                renderTranscript({ onOpenFile: handleOpenFile })
              ) : (
                <Transcript
                  state={state}
                  approval={approval}
                  onApprove={() => setApproval(EConfirmationState.Approved)}
                  onDeny={() => setApproval(EConfirmationState.Denied)}
                  onOpenFile={handleOpenFile}
                />
              )}
              {composer ?? (
                <Composer
                  steps={planFor(state)}
                  queued={queued}
                  busy={busy}
                  onRemoveQueued={handleRemoveQueued}
                  onSend={handleSend}
                />
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            id="right-panel"
            panelRef={panelRef}
            collapsible
            collapsedSize="0%"
            defaultSize={initialPanelOpen ? '40%' : '0%'}
            minSize="26%"
            maxSize="60%"
            onResize={handlePanelResize}
          >
            <RightPanel
              tab={tab}
              onTabChange={setTab}
              expanded={expanded}
              onExpandedChange={setExpanded}
              initialTerminalConnection={initialTerminalConnection}
              initialPreviewId={initialPreviewId}
              pod={pod}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </AppShell>
    </TooltipProvider>
  )
}
