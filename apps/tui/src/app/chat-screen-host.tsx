import type { KeyEvent } from '@opentui/core'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { EClientAction } from '@dltech/atlas-commands'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { chordMatches, EKeyGroup, EKeyLayer, type KeyBinding } from '../ui/keys'
import { ENoticeTone, notify } from '../ui/notice-store'
import { AgentTranscriptScreen } from './agent-transcript'
import { chatBindings, chatPressHandled } from './chat-bindings'
import { ChatScreen } from './chat-screen'
import { connectionViewOf } from './connection-view'
import { dispatchPaneKey } from './pane-keys'
import { pendingOperatorRequestOf } from './operator-request'
import { pendingRowsOf } from './pending-rows'
import type { SessionClient } from './session-client'
import { useStagedMessages } from './staged-messages'
import { useOperatorInput } from './use-operator-input'
import { usePendingTakeBack } from './use-pending-take-back'
import { useRunAttention } from './use-run-attention'
import { useSessionAttachments } from './use-session-attachments'
import { useCommandMenu } from './use-command-menu'
import { useRewind } from './use-rewind'
import { useSessionComposer } from './use-session-composer'
import { useTuiCommands } from './use-tui-commands'
import { useSessionSend } from './use-session-send'
import { useChatKeys } from './use-chat-keys'
import { useSessionPanes } from './use-session-panes'
import { useSessionTranscript } from './use-session-transcript'
import { EPodWake, useSessionWake } from './use-session-wake'

const problemOf = (reason: string): void => {
  notify({ text: reason, tone: ENoticeTone.Warn })
}

const global = (binding: Omit<KeyBinding, 'layer'>): KeyBinding => ({
  ...binding,
  layer: EKeyLayer.Global,
})

export function ChatScreenHost(props: {
  client: SessionClient
  sessionId: string
  title: string | null
  width: number
  height: number
  now: () => number
  cwd: string
  onBack: () => void
  onNew: () => void
  onModel: () => void
  onQuit: () => void
  onKeys: (handler: (key: KeyEvent) => boolean) => void
  choosingModel: boolean
  clientVersion: string
  teammates: readonly StreamSessionRow[]
  onOpenSession: (agentId: string) => void
}): React.ReactNode {
  const transcript = useSessionTranscript({
    client: props.client,
    sessionId: props.sessionId,
    title: props.title,
    now: props.now,
  })

  const panes = useSessionPanes({
    transcript,
    sessionId: props.sessionId,
    teammates: props.teammates,
    onOpenSession: props.onOpenSession,
    onProblem: problemOf,
  })
  const [sidebarOpen, setSidebarOpen] = useState(true)

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

  const runName = useRef<(name: string) => void>(() => undefined)
  const runAction = useRef<(action: EClientAction) => void>(() => undefined)

  const rewind = useRewind({
    api: props.client.api,
    sessionId: props.sessionId,
    rawEvents: transcript.rawEvents,
    draft: composer.draft,
    attachments,
    onProblem: problemOf,
  })

  const menu = useCommandMenu({
    api: props.client.api,
    draft: composer.draft,
    onAction: (action) => runAction.current(action),
    onLocal: (name) => runName.current(name),
    onRun: (text) => {
      composer.draft.setValue(text)
      composer.handleSubmit()
    },
    onProblem: problemOf,
  })

  const commands = useTuiCommands({
    sessionId: props.sessionId,
    cwd: props.cwd,
    onNew: props.onNew,
    onSessions: props.onBack,
    onQuit: props.onQuit,
    onModel: props.onModel,
    onHelp: menu.handleOpen,
    onRewind: rewind.handleOpen,
    onWake: wake.handleWake,
    onShells: panes.shells.handleToggle,
    onProblem: problemOf,
  })
  runName.current = commands.run
  runAction.current = commands.action

  const readMenu = useRef(menu.handleText)
  readMenu.current = menu.handleText

  useEffect(() => {
    readMenu.current(composer.draft.value)
  }, [composer.draft.value, menu.entries])

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

  const { onBack } = props

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
    working: transcript.working,
    onToggleSidebar: () => setSidebarOpen((open) => !open),
    onBack,
    onStop: send.handleStop,
  })

  const onKeys = props.onKeys
  useEffect(() => {
    onKeys(handleKey)
  }, [handleKey, onKeys])

  const viewing = panes.crew.viewing
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
        onBack={onBack}
      />
    )
  }

  return (
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
      onSelectSubagent={panes.crew.handleSelect}
      onOpenTeammate={props.onOpenSession}
    />
  )
}
