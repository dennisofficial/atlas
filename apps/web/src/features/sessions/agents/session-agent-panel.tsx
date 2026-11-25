'use client'

import { ArrowLeftIcon, WifiOffIcon } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { NOTHING_IN_BACKGROUND } from '@dltech/atlas-client/crew'
import { agentOf } from '@dltech/atlas-client/transcript'
import { EAgentStatus, resumableOf, resumePointOf } from '@dltech/atlas-core'
import { Button } from '@dltech/atlas-ui/components/button'

import { messageOf } from '@/features/threads/data/message-of'
import { RESUMING_LABEL, RESUME_LABEL } from '@/features/threads/transcript/stopped-line'

import {
  ThreadPanelProvider,
  useThreadPanel,
  type ThreadPanelValue,
} from '@/features/threads/panel/thread-panel-context'
import { TabPlaceholder } from '@/features/threads/panel/tab-placeholder'
import { TranscriptLoading } from '@/features/threads/panel/agents/agents-skeletons'
import { ThreadTranscript } from '@/features/threads/thread-transcript'
import { SessionDiagramRepairProvider } from '@/features/threads/data/session-diagram-repair-provider'

import { crewStatusLabelOf } from '../data/crew-status-label'
import { requestResume, resumePendingOf } from '../data/session-commands'
import { sessionsApi } from '../data/sessions-api'
import { sessionStateLineOf } from '../data/session-state'
import { sessionTranscriptOf } from '../data/session-transcript'
import { useDiagramRepairedTranscript } from '../data/use-session-diagram-transcript'
import { useSessionPaneValue } from '../panel/pane-value'
import { EAgentPanelState, agentPanelStateOf } from './agent-panel-state'
import { useAgentStream } from './use-agent-stream'

type AgentIdentity = {
  agentType: string | undefined
  intent: string | undefined
  status: string | undefined
  working: boolean
}

type BackLabel = { text: string; aria: string }

const SESSION_BACK: BackLabel = { text: 'Session', aria: 'Back to session' }

const PARENT_BACK: BackLabel = {
  text: 'Sub-agent',
  aria: 'Back to the sub-agent that started this one',
}

export function AgentPanelHeader({
  agentId,
  identity,
  backLabel,
  resume,
  onClose,
}: {
  agentId: string
  identity: AgentIdentity
  backLabel: BackLabel
  resume: { pending: boolean; onResume: () => void } | null
  onClose: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-2 py-1.5">
      <Button variant="ghost" size="xs" onClick={onClose} aria-label={backLabel.aria}>
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        {backLabel.text}
      </Button>
      <span data-agent-type className="shrink-0 font-mono text-xs text-muted-foreground">
        {identity.agentType ?? agentId}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs" title={identity.intent ?? agentId}>
        {identity.intent ?? agentId}
      </span>
      {identity.status === undefined ? null : (
        <span data-agent-status className="shrink-0 text-xs text-muted-foreground">
          {identity.status}
        </span>
      )}
      {resume === null ? null : (
        <Button
          data-slot="resume-agent"
          variant="ghost"
          size="xs"
          disabled={resume.pending}
          onClick={resume.onResume}
        >
          {resume.pending ? RESUMING_LABEL : RESUME_LABEL}
        </Button>
      )}
    </div>
  )
}

function useMainAgentIdentity(agentId: string): AgentIdentity {
  const { view } = useSessionPaneValue()
  const row = view.crewRows.find((candidate) => candidate.agentId === agentId)
  return {
    agentType: row?.agentType,
    intent: row?.intent,
    status: row === undefined ? undefined : crewStatusLabelOf(row.status),
    working: row?.status === EAgentStatus.Running,
  }
}

function useNestedAgentIdentity(args: { agentId: string; parentAgentId: string }): AgentIdentity {
  const { sessionId } = useSessionPaneValue()
  const { snapshot } = useAgentStream({ sessionId, agentId: args.parentAgentId })
  const agent = useMemo(
    () => agentOf({ events: snapshot.foldable, agentId: args.agentId }),
    [snapshot.foldable, args.agentId],
  )
  return {
    agentType: agent?.agentType,
    intent: agent?.intent,
    status: agent?.running === true ? crewStatusLabelOf(EAgentStatus.Running) : undefined,
    working: agent?.running ?? false,
  }
}

function AgentPanelBody({
  agentId,
  identity,
  backLabel,
  onClose,
}: {
  agentId: string
  identity: AgentIdentity
  backLabel: BackLabel
  onClose: () => void
}) {
  const { sessionId, status } = useSessionPaneValue()
  const panel = useThreadPanel()
  const { snapshot, loadOlder } = useAgentStream({ sessionId, agentId })
  const transcript = sessionTranscriptOf({ events: snapshot.events, overlay: snapshot.overlay })
  const { items: transcriptItems, repairDiagram } = useDiagramRepairedTranscript({
    sessionId,
    items: transcript.items,
  })
  const state = agentPanelStateOf(snapshot)
  const resume = useMemo(() => {
    if (!resumableOf(resumePointOf({ events: snapshot.events }))) return null
    return {
      pending: resumePendingOf(status?.commands),
      onResume: () => {
        requestResume({ api: sessionsApi, sessionId, agentId }).catch((failure: unknown) => {
          toast.error(messageOf(failure))
        })
      },
    }
  }, [snapshot.events, status?.commands, sessionId, agentId])
  const nestedPanel = useMemo<ThreadPanelValue>(
    () => ({
      ...panel,
      agentId,
      agentParentId: undefined,
      openAgent: (childId: string) => panel.openAgent(childId, agentId),
    }),
    [panel, agentId],
  )
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <AgentPanelHeader
        agentId={agentId}
        identity={identity}
        backLabel={backLabel}
        resume={resume}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {state === EAgentPanelState.Error ? (
          <TabPlaceholder
            icon={<WifiOffIcon />}
            title="Transcript unavailable"
            description={
              sessionStateLineOf({
                status: undefined,
                connection: snapshot.connection,
                error: snapshot.error,
              }) ?? 'The sub-agent transcript could not be read.'
            }
          />
        ) : null}
        {state === EAgentPanelState.Loading ? (
          <TranscriptLoading />
        ) : state === EAgentPanelState.Ready ? (
          <ThreadPanelProvider value={nestedPanel}>
            <SessionDiagramRepairProvider repairDiagram={repairDiagram}>
              <ThreadTranscript
                items={transcriptItems}
                failureCard={null}
                failedLabel={null}
                pod={null}
                working={identity.working}
                background={NOTHING_IN_BACKGROUND}
                onRetryBoot={() => undefined}
                rewind={null}
                summarise={null}
                onLoadOlder={loadOlder}
              />
            </SessionDiagramRepairProvider>
          </ThreadPanelProvider>
        ) : null}
      </div>
    </div>
  )
}

function MainAgentPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const identity = useMainAgentIdentity(agentId)
  return (
    <AgentPanelBody
      agentId={agentId}
      identity={identity}
      backLabel={SESSION_BACK}
      onClose={onClose}
    />
  )
}

function NestedAgentPanel({
  agentId,
  parentAgentId,
  onClose,
}: {
  agentId: string
  parentAgentId: string
  onClose: () => void
}) {
  const identity = useNestedAgentIdentity({ agentId, parentAgentId })
  return (
    <AgentPanelBody
      agentId={agentId}
      identity={identity}
      backLabel={PARENT_BACK}
      onClose={onClose}
    />
  )
}

export function SessionAgentPanel({
  agentId,
  parentAgentId,
  onClose,
}: {
  agentId: string
  parentAgentId?: string | undefined
  onClose: () => void
}) {
  if (parentAgentId === undefined) return <MainAgentPanel agentId={agentId} onClose={onClose} />
  return <NestedAgentPanel agentId={agentId} parentAgentId={parentAgentId} onClose={onClose} />
}
