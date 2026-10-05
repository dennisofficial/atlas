import { homedir } from 'node:os'

import React from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EChannelConnection } from '@dltech/atlas-harness'

import { versionLabel } from '../build/info'
import { useAttachFailure } from './attach-failure'
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

export function WorkspaceTranscript(props: {
  app: AtlasApp
  welcome: boolean
  wide: boolean
  width: number
  modelId: string
  thinking: EThinkingVisibility
  agentView: Pick<AgentView, 'selected' | 'scopedTo' | 'backLabel' | 'handleBack'>
  conversation: Pick<
    Conversation,
    | 'model'
    | 'now'
    | 'projectDirectory'
    | 'turn'
    | 'pending'
    | 'handleRetry'
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
  const { location, threadId } = useSessionOwner({ app })
  const attachFailed = useAttachFailure()
  const attachClosed =
    cloudSession === null &&
    location === EExecutionLocation.Cloud &&
    attachFailed !== null &&
    attachFailed.threadId === threadId
  const connection =
    cloudHealth?.connection?.state ?? (attachClosed ? EChannelConnection.Closed : undefined)

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
          model={conversation.model}
          width={width}
          now={conversation.now}
          cwd={conversation.projectDirectory}
          turn={conversation.turn}
          waking={connection === EChannelConnection.Waking}
          reconnecting={
            connection === EChannelConnection.Reconnecting ||
            connection === EChannelConnection.Connecting ||
            connection === EChannelConnection.Reattaching
          }
          disconnected={connection === EChannelConnection.Closed}
          stale={cloudHealth?.stale === true}
          reconnectingSince={props.reconnectingSince}
          {...(connection === EChannelConnection.Closed
            ? { onReconnect: () => (cloudSession === null ? props.onRetryAttach() : cloudSession.reconnect()) }
            : {})}
          sends={props.sends}
          pending={conversation.pending}
          background={props.background}
          waitingSince={props.waitingSince}
          {...(conversation.handleRetry === null ? {} : { onRetry: conversation.handleRetry })}
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
