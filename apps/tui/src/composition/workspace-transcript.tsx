import { homedir } from 'node:os'

import React, { useMemo, useSyncExternalStore } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EConnectionView } from '@dltech/atlas-harness'

import { versionLabel } from '../build/info'
import { useAttachFailure } from './attach-failure'
import { bornPlacementChip } from './cloud/born-placement-chip'
import type { EThinkingVisibility } from '../store'
import type { BackgroundWork } from '../ui/background-wait'
import { BackPill } from '../ui/components/back-pill'
import { Transcript } from '../ui/components/transcript'
import { TranscriptLoading, transcriptLoading } from '../ui/components/transcript-loading'
import { WelcomeScreen } from '../ui/components/welcome-screen'
import type { PodHealth, PodSession } from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'
import { SubagentTranscript } from './subagent-transcript'
import { TeammateTranscript } from './teammate-transcript'
import type { InlineBoot } from './use-inline-boot'
import { useFailureAccountLabel } from './use-failure-account-label'
import { useSessionOwner } from './use-session-owner'
import type { AgentView } from './use-agent-view'
import type { Conversation } from './use-conversation'

const UPDATING_LABEL = 'updating the pod'

export function WorkspaceTranscript(props: {
  app: AtlasApp
  welcome: boolean
  bootingCloudThread: boolean
  inlineBoot: InlineBoot
  wide: boolean
  width: number
  modelId: string
  placementShape: 'chip' | 'hero'
  thinking: EThinkingVisibility
  agentView: Pick<AgentView, 'selected' | 'scopedTo' | 'backLabel' | 'handleBack'>
  conversation: Pick<
    Conversation,
    | 'threadId'
    | 'sessionName'
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
  cloudHealth: PodHealth | null
  cloudSession: PodSession | null
  reconnectingSince: number | null
  onRetryAttach: () => void
  sends: number
  background: BackgroundWork
  waitingSince: number | null
  opened: ReadonlySet<string>
  onToggle: (key: string) => void
}): React.ReactNode {
  const { app, welcome, width, thinking, agentView, conversation, cloudHealth, cloudSession } =
    props
  const { location, threadId } = useSessionOwner({ app })
  const attachFailed = useAttachFailure()
  const accountLabel = useFailureAccountLabel({
    accounts: app.accounts,
    accountId: conversation.model.failure?.failure?.accountId,
  })
  const chip = bornPlacementChip(app)
  const unplaced = useSyncExternalStore(chip.subscribe, chip.snapshot)
  const placement =
    app.pods && unplaced !== null && unplaced.threadId === conversation.threadId
      ? {
          harness: unplaced.harness,
          runner: unplaced.runner,
          provisioning: unplaced.provisioning,
        }
      : null
  const attachClosed =
    cloudSession === null &&
    (location === EExecutionLocation.Cloud || props.bootingCloudThread) &&
    attachFailed !== null &&
    (attachFailed.threadId === threadId || props.bootingCloudThread)
  const connection =
    cloudHealth?.view.state ?? (attachClosed ? EConnectionView.Disconnected : undefined)
  const pending = useMemo(
    () => [...conversation.pending, ...props.inlineBoot.arrivalRows],
    [conversation.pending, props.inlineBoot.arrivalRows],
  )
  const updating = connection === EConnectionView.Updating
  const loadingTranscript = transcriptLoading({
    empty: conversation.model.isEmpty,
    bootingCloudThread: props.bootingCloudThread,
    attachFailed: attachFailed !== null,
    firstReadLanded: (cloudHealth?.lastSeenAt ?? null) !== null,
  })

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1}>
      {agentView.backLabel === null || props.wide ? null : (
        <BackPill label={agentView.backLabel} onBack={agentView.handleBack} />
      )}
      <box flexGrow={welcome ? 1 : 0} flexShrink={1} />
      {loadingTranscript ? (
        <TranscriptLoading name={conversation.sessionName} />
      ) : welcome && !attachClosed ? (
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
            ? {
                onReconnect: () =>
                  cloudSession === null ? props.onRetryAttach() : cloudSession.reconnect(),
              }
            : {})}
          sends={props.sends}
          {...(accountLabel === undefined ? {} : { accountLabel })}
          pending={pending}
          boot={props.inlineBoot.block}
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
            ? {
                onNearTop: () => void conversation.loadOlderHistory().catch(() => undefined),
              }
            : {})}
        />
      )}
    </box>
  )
}
