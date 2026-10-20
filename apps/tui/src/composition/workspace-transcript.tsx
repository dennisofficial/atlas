import { homedir } from 'node:os'

import React, { useSyncExternalStore } from 'react'

import { EConnectionView } from '@dltech/atlas-harness'

import { versionLabel } from '../build/info'
import { useAttachFailure } from './attach-failure'
import { bornPlacementChip } from './cloud/born-placement-chip'
import type { EThinkingVisibility } from '../store'
import type { BackgroundWork } from '../ui/background-wait'
import { BackPill } from '../ui/components/back-pill'
import { Transcript } from '../ui/components/transcript'
import { WelcomeScreen } from '../ui/components/welcome-screen'
import type { CloudHealth, CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import { SubagentTranscript } from './subagent-transcript'
import { TeammateTranscript } from './teammate-transcript'
import { useSessionOwner } from './use-session-owner'
import type { AgentView } from './use-agent-view'
import type { Conversation } from './use-conversation'

const UPDATING_LABEL = 'updating the cloud sandbox'

export function WorkspaceTranscript(props: {
  app: AtlasApp
  welcome: boolean
  wide: boolean
  width: number
  modelId: string
  placementShape: 'chip' | 'hero'
  thinking: EThinkingVisibility
  agentView: Pick<AgentView, 'selected' | 'scopedTo' | 'backLabel' | 'handleBack'>
  conversation: Pick<
    Conversation,
    | 'threadId'
    | 'model'
    | 'now'
    | 'projectDirectory'
    | 'turn'
    | 'rotating'
    | 'pending'
    | 'handleRetry'
    | 'handleDismissFailure'
    | 'handleResume'
    | 'hasOlderHistory'
    | 'loadOlderHistory'
  >
  cloudHealth: CloudHealth | null
  cloudSession: CloudSession | null
  reconnectingSince: number | null
  onRetryAttach: () => void
  sends: number
  background: BackgroundWork
  waitingSince: number | null
  opened: ReadonlySet<string>
  onToggle: (key: string) => void
}): React.ReactNode {
  const { app, welcome, width, thinking, agentView, conversation, cloudHealth, cloudSession } = props
  const { placed, threadId } = useSessionOwner({ app })
  const attachFailed = useAttachFailure()
  const chip = bornPlacementChip(app)
  const unplaced = useSyncExternalStore(chip.subscribe, chip.snapshot)
  const placement =
    unplaced !== null && unplaced.threadId === conversation.threadId
      ? {
          runner: unplaced.runner,
          provisioning: unplaced.provisioning,
        }
      : null
  const attachClosed =
    cloudSession === null &&
    placed &&
    attachFailed !== null &&
    attachFailed.threadId === threadId
  const connection =
    cloudHealth?.view.state ?? (attachClosed ? EConnectionView.Disconnected : undefined)
  const updating = connection === EConnectionView.Updating

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1}>
      {agentView.backLabel === null || props.wide ? null : (
        <BackPill label={agentView.backLabel} onBack={agentView.handleBack} />
      )}
      <box flexGrow={welcome ? 1 : 0} flexShrink={1} />
      {welcome ? (
        <WelcomeScreen
          cwd={app.config.cwd}
          home={homedir()}
          modelId={props.modelId}
          version={versionLabel()}
          width={width}
          shape={props.placementShape}
          placement={placement}
        />
      ) : agentView.selected !== null ? (
        <SubagentTranscript
          app={app}
          agent={agentView.selected}
          thinking={thinking}
          width={width}
          cwd={conversation.projectDirectory}
          opened={props.opened}
          onToggle={props.onToggle}
        />
      ) : agentView.scopedTo !== null ? (
        <TeammateTranscript
          app={app}
          agent={agentView.scopedTo}
          thinking={thinking}
          width={width}
          cwd={conversation.projectDirectory}
          opened={props.opened}
          onToggle={props.onToggle}
        />
      ) : (
        <Transcript
          key={conversation.threadId}
          cloudConnected={connection === EConnectionView.Connected}
          model={conversation.model}
          width={width}
          now={conversation.now}
          cwd={conversation.projectDirectory}
          turn={conversation.turn}
          rotating={conversation.rotating}
          waking={connection === EConnectionView.Waking}
          reconnecting={connection === EConnectionView.Reconnecting || updating}
          {...(updating ? { updating: cloudHealth?.view.detail ?? UPDATING_LABEL } : {})}
          disconnected={connection === EConnectionView.Disconnected}
          stale={cloudHealth?.stale === true}
          reconnectingSince={props.reconnectingSince}
          {...(connection === EConnectionView.Disconnected
            ? { onReconnect: () => (cloudSession === null ? props.onRetryAttach() : cloudSession.reconnect()) }
            : {})}
          sends={props.sends}
          pending={conversation.pending}
          background={props.background}
          waitingSince={props.waitingSince}
          {...(conversation.handleRetry === null ? {} : { onRetry: conversation.handleRetry })}
          {...(conversation.handleDismissFailure === null
            ? {}
            : { onDismissFailure: conversation.handleDismissFailure })}
          {...(conversation.handleResume === null ? {} : { onResume: conversation.handleResume })}
          opened={props.opened}
          onToggle={props.onToggle}
          {...(conversation.hasOlderHistory
            ? { onNearTop: () => void conversation.loadOlderHistory().catch(() => undefined) }
            : {})}
        />
      )}
    </box>
  )
}
