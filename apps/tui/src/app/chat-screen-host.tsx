import type { KeyEvent } from '@opentui/core'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AgentTranscriptScreen } from './agent-transcript'
import type { ChatScreenHostProps } from './chat-screen-host-props'
import { ChatScreen } from './chat-screen'
import { connectionViewOf } from './connection-view'
import { pendingOperatorRequestOf } from './operator-request'
import { pendingRowsOf } from './pending-rows'
import { useStagedMessages } from './staged-messages'
import { useOperatorInput } from './use-operator-input'
import { usePendingTakeBack } from './use-pending-take-back'
import { useRunAttention } from './use-run-attention'
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
import { MIN_TRANSCRIPT_WIDTH } from '../ui/theme'
import { sidebarWidth } from '../ui/sidebar-width-store'
import { isPrintable } from '../ui/keys/printable'
import { messageOf, problemOf } from './app-next-support'

export function ChatScreenHost(props: ChatScreenHostProps): React.ReactNode {
  const transcript = useSessionTranscript({
    client: props.client,
    sessionId: props.sessionId,
    title: props.title,
    now: props.now,
  })

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const contentWidth = sidebarOpen
    ? Math.max(MIN_TRANSCRIPT_WIDTH, props.width - sidebarWidth())
    : props.width
  const restoreText = useRef<(args: { text: string; reason: string | undefined }) => void>(
    () => undefined,
  )

  const staged = useStagedMessages({
    sessionId: props.sessionId,
    events: transcript.rawEvents,
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

  restoreText.current = (args: { text: string; reason: string | undefined }) => {
    composer.tokens.restore({ text: args.text, images: [] })
    if (args.reason !== undefined) problemOf(args.reason)
  }

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

  const runCommand = useCallback(
    (input: { name: string; args: Record<string, unknown> }) => {
      props.client.api
        .runCommand({ sessionId: props.sessionId, ...input })
        .catch((failure: unknown) => problemOf(messageOf(failure)))
    },
    [props.client.api, props.sessionId],
  )

  const panes = useSessionPanes({
    api: props.client.api,
    transcript,
    api: props.client.api,
    sessionId: props.sessionId,
    teammates: props.teammates,
    sections: chrome.sections,
    onOpenSession: props.onOpenSession,
    onStopAgent: (agentId) => runCommand({ name: 'agent', args: { action: 'stop', agentId } }),
    onKillShell: (shellId) => runCommand({ name: 'shell-kill', args: { shellId } }),
    onStopService: (serviceId) =>
      runCommand({ name: 'service', args: { action: 'stop', serviceId } }),
    onRestartService: (serviceId) =>
      runCommand({ name: 'service', args: { action: 'restart', serviceId } }),
    onProblem: problemOf,
  })

  const takeBack = usePendingTakeBack({
    api: props.client.api,
    sessionId: props.sessionId,
    pending: transcript.pending,
    staged,
    draft: composer.draft,
    tokens: composer.tokens,
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

  const pending = useMemo(
    () =>
      pendingRowsOf({
        pending: transcript.pending,
        staged: staged.staged,
        refused: staged.refused,
        working: transcript.working,
      }),
    [staged.refused, staged.staged, transcript.pending, transcript.working],
  )

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
  const [agentMessage, setAgentMessage] = useState<string | null>(null)

  const handleAgentKey = useCallback(
    (key: KeyEvent): boolean => {
      if (viewing === null) return false
      if (agentMessage === null) {
        if (key.name !== 'm') return false
        setAgentMessage('')
        return true
      }
      if (key.name === 'escape') {
        setAgentMessage(null)
        return true
      }
      if (key.name === 'return') {
        runCommand({ name: 'agent', args: { action: 'say', agentId: viewing, text: agentMessage } })
        setAgentMessage(null)
        return true
      }
      if (key.name === 'backspace') {
        setAgentMessage(agentMessage.slice(0, -1))
        return true
      }
      if (isPrintable(key)) setAgentMessage(agentMessage + (key.sequence ?? ''))
      return true
    },
    [agentMessage, runCommand, viewing],
  )

  const chatKeys = useRef(handleKey)
  chatKeys.current = handleKey
  const agentKeys = useRef(handleAgentKey)
  agentKeys.current = handleAgentKey
  const panelKeys = useRef(panels.handleKey)
  panelKeys.current = panels.handleKey
  const withPanels = useCallback((key: KeyEvent): boolean => {
    if (agentKeys.current(key)) return true
    if (panelKeys.current(key)) return true
    chatKeys.current(key)
    return true
  }, [])

  const onKeys = props.onKeys
  useEffect(() => {
    onKeys(withPanels)
  }, [onKeys, withPanels])

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
        message={agentMessage}
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
        onSelectSubagent={panes.crew.handleSelect}
        onOpenTeammate={props.onOpenSession}
        onShellKill={(shellId) => runCommand({ name: 'shell-kill', args: { shellId } })}
        header={chrome.header}
        footer={chrome.footer}
        footerContext={chrome.footerContext}
        footerStrip={chrome.footerStrip}
      />
      {panels.render(props.width)}
    </>
  )
}
