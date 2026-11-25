import React, { useMemo, useRef, useState } from 'react'

import { AgentTranscriptScreen } from './agent-transcript'
import { useAgentMessage } from './use-agent-message'
import { useKeyHandlerStack } from './use-key-handler-stack'
import type { ChatScreenHostProps } from './chat-screen-host-props'
import { ChatScreen } from './chat-screen'
import { composerRestoreOf, type ComposerRestore } from './composer-restore'
import { connectionViewOf } from './connection-view'
import { pendingOperatorRequestOf } from './operator-request'
import { usePendingRows } from './use-pending-rows'
import { useStagedMessages } from './staged-messages'
import { useOperatorInput } from './use-operator-input'
import { usePendingTakeBack } from './use-pending-take-back'
import { useRunAttention } from './use-run-attention'
import { useQuickStopRestore } from './use-quick-stop-restore'
import { useSessionAttachments } from './use-session-attachments'
import { useRewind } from './use-rewind'
import { useSessionComposer } from './use-session-composer'
import { useSessionSend } from './use-session-send'
import { useChatKeys } from './use-chat-keys'
import { useSessionChrome } from './use-session-chrome'
import { useSessionPanes } from './use-session-panes'
import { useSessionTranscript } from './use-session-transcript'
import { useSessionCommands } from './use-session-commands'
import { useSessionWake } from './use-session-wake'
import { useTranscriptPanels } from './use-transcript-panels'
import { useToolPictureSession } from '../ui/use-tool-picture-session'
import { MIN_TRANSCRIPT_WIDTH } from '../ui/theme'
import { sidebarWidth } from '../ui/sidebar-width-store'
import { problemOf } from './app-next-support'
import { useCommandRunner } from './use-command-runner'

export function ChatScreenHost(props: ChatScreenHostProps): React.ReactNode {
  const transcript = useSessionTranscript({
    client: props.client,
    sessionId: props.sessionId,
    title: props.title,
    now: props.now,
  })

  useToolPictureSession({ api: props.client.api, sessionId: props.sessionId })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const contentWidth = sidebarOpen
    ? Math.max(MIN_TRANSCRIPT_WIDTH, props.width - sidebarWidth())
    : props.width
  const restoreText = useRef<ComposerRestore>(() => undefined)

  const staged = useStagedMessages({
    sessionId: props.sessionId,
    events: transcript.rawEvents,
    pending: transcript.pending,
    working: transcript.working,
    onRestore: (args) => restoreText.current(args),
  })
  const attachments = useSessionAttachments({
    api: props.client.api,
    sessionId: props.sessionId,
    onProblem: problemOf,
  })
  const send = useSessionSend({
    api: props.client.api,
    sessionId: props.sessionId,
    staged,
    onProblem: problemOf,
  })

  const composer = useSessionComposer({
    api: props.client.api,
    sessionId: props.sessionId,
    attachments,
    send,
    onProblem: problemOf,
    onSlashCommand: (text) => menu.handleSubmit(text),
  })

  restoreText.current = composerRestoreOf({
    tokens: composer.tokens,
    attachments,
    onProblem: problemOf,
  })

  const chrome = useSessionChrome({
    api: props.client.api,
    sessionId: props.sessionId,
    row: props.row,
    view: transcript.view,
    status: transcript.status,
    working: transcript.working,
    width: contentWidth,
    now: props.now,
    draft: composer.draft,
    openUrl: props.openUrl,
    onProblem: problemOf,
  })

  const actions = useCommandRunner({ api: props.client.api, sessionId: props.sessionId })

  const panes = useSessionPanes({
    transcript,
    api: props.client.api,
    sessionId: props.sessionId,
    teammates: props.teammates,
    sections: chrome.sections,
    onOpenSession: props.onOpenSession,
    onStopAgent: actions.stopAgent,
    onKillShell: actions.killShell,
    onStopService: actions.stopService,
    onRestartService: actions.restartService,
    onProblem: problemOf,
  })

  const takeBack = usePendingTakeBack({
    api: props.client.api,
    sessionId: props.sessionId,
    pending: transcript.pending,
    foldable: transcript.foldable,
    queueKnown: transcript.loaded,
    draft: composer.draft,
    restore: (restored) => restoreText.current(restored),
    onProblem: problemOf,
  })

  const request = useMemo(
    () => pendingOperatorRequestOf({ events: transcript.rawEvents }),
    [transcript.rawEvents],
  )

  const operator = useOperatorInput({
    api: props.client.api,
    sessionId: props.sessionId,
    request,
    onProblem: problemOf,
  })

  const connection = useMemo(
    () => connectionViewOf({ connection: transcript.connection, status: transcript.status }),
    [transcript.connection, transcript.status],
  )

  const attention = useRunAttention({
    api: props.client.api,
    sessionId: props.sessionId,
    events: transcript.events,
    rawEvents: transcript.rawEvents,
    live: transcript.liveSteps,
    working: transcript.working,
    connected: connection.cloudConnected,
    onProblem: problemOf,
  })

  const wake = useSessionWake({
    api: props.client.api,
    sessionId: props.sessionId,
    live: connection.cloudConnected,
  })

  useQuickStopRestore({
    sessionId: props.sessionId,
    quickStops: transcript.quickStops,
    draft: composer.draft,
    attachments,
  })

  const rewind = useRewind({
    api: props.client.api,
    sessionId: props.sessionId,
    rawEvents: transcript.rawEvents,
    draft: composer.draft,
    attachments,
    onProblem: problemOf,
  })

  const panels = useTranscriptPanels({
    api: props.client.api,
    views: transcript.view?.pluginViews ?? {},
    events: transcript.rawEvents,
    openUrl: props.openUrl,
    onProblem: problemOf,
    onComplete: (name) => composer.draft.setValue(`/${name} `),
  })

  const commands = useSessionCommands({
    api: props.client.api,
    draft: composer.draft,
    onSubmit: composer.handleSubmit,
    sessionId: props.sessionId,
    cwd: props.cwd,
    onNew: props.onNew,
    onSessions: props.onBack,
    onQuit: props.onQuit,
    onModel: props.onModel,
    onRewind: rewind.handleOpen,
    onWake: wake.handleWake,
    onShells: panes.shells.handleToggle,
    onSkills: panels.skills.handleOpen,
    onMcp: panels.mcp.handleOpen,
    onSettings: props.onSettings,
    onAuth: props.onAuth,
    onProblem: problemOf,
  })
  const menu = commands.menu

  const pending = usePendingRows({
    pending: transcript.pending,
    staged: staged.staged,
    refused: staged.refused,
    working: transcript.working,
    hiddenInboxIds: takeBack.hiddenInboxIds,
  })

  const handleKey = useChatKeys({
    composer,
    handleTakeBack: takeBack.handleTakeBack,
    attention,
    wake,
    connection,
    operator,
    menu,
    rewind,
    panes,
    footerStrip: chrome.footerStrip,
    working: transcript.working,
    onToggleSidebar: () => setSidebarOpen((open) => !open),
    onBack: props.onBack,
    onStop: send.handleStop,
  })

  const viewing = panes.crew.viewing
  const agent = useAgentMessage({ viewing, onSay: actions.say })

  useKeyHandlerStack({
    chat: handleKey,
    agent: agent.handleKey,
    panels: panels.handleKey,
    onKeys: props.onKeys,
  })

  if (viewing !== null) {
    return (
      <AgentTranscriptScreen
        client={props.client}
        sessionId={props.sessionId}
        agentId={viewing}
        name={panes.crew.rows.find((row) => row.id === viewing)?.name ?? viewing}
        width={props.width}
        cwd={props.cwd}
        now={props.now}
        backLabel={panes.crew.backLabel}
        message={agent.message}
        onBack={props.onBack}
      />
    )
  }

  return (
    <>
      <ChatScreen
        transcript={transcript}
        composer={composer}
        pending={pending}
        operator={operator}
        attention={attention}
        connection={connection}
        wake={wake}
        width={props.width}
        height={props.height}
        cwd={props.cwd}
        now={props.now()}
        sends={send.sends}
        choosingModel={props.choosingModel}
        working={transcript.working}
        onReconnect={wake.handleWake}
        menu={menu}
        rewind={rewind}
        onMenuSelect={menu.handleSelectRow}
        sidebar={sidebarOpen ? panes.sidebar : null}
        sidebarRoot={panes.panes.repo ?? props.cwd}
        clientVersion={props.clientVersion}
        paneNow={panes.paneNow}
        shellFold={panes.shells.fold}
        serviceFold={panes.serviceFold}
        shells={panes.shells}
        services={panes.services}
        context={panes.context}
        openUrl={props.openUrl}
        onSelectSubagent={panes.crew.handleSelect}
        onOpenTeammate={props.onOpenSession}
        onShellKill={actions.killShell}
        header={chrome.header}
        footer={chrome.footer}
        footerContext={chrome.footerContext}
        footerStrip={chrome.footerStrip}
      />
      {panels.render(props.width)}
    </>
  )
}
