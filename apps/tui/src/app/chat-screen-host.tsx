import type { KeyEvent } from '@opentui/core'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'

import type { EClientAction } from '@dltech/atlas-commands'

import { chordMatches, EKeyGroup, EKeyLayer, type KeyBinding } from '../ui/keys'
import { ENoticeTone, notify } from '../ui/notice-store'
import { chatBindings, chatPressHandled } from './chat-bindings'
import { ChatScreen } from './chat-screen'
import { connectionViewOf } from './connection-view'
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
}): React.ReactNode {
  const transcript = useSessionTranscript({
    client: props.client,
    sessionId: props.sessionId,
    title: props.title,
    now: props.now,
  })

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
  const { handleStop } = send

  const handleEscape = useCallback(() => {
    if (transcript.working) {
      handleStop()
      return
    }
    onBack()
  }, [handleStop, onBack, transcript.working])

  const extra = useMemo<readonly KeyBinding[]>(() => {
    const list: KeyBinding[] = []
    if (!connection.cloudConnected) {
      list.push(
        global({
          chord: 'ctrl+r',
          hint: 'reconnect',
          describe: 'wake the sandbox and follow it again',
          group: EKeyGroup.Turn,
          run: wake.handleWake,
        }),
      )
    } else if (attention.handleRetry !== null) {
      list.push(
        global({
          chord: 'ctrl+r',
          hint: 'retry',
          describe: 'run the failed turn again',
          group: EKeyGroup.Turn,
          run: attention.handleRetry,
        }),
      )
    } else if (attention.handleResume !== null) {
      list.push(
        global({
          chord: 'ctrl+r',
          hint: 'resume',
          describe: 'pick the stopped turn up where it left off',
          group: EKeyGroup.Turn,
          run: attention.handleResume,
        }),
      )
    }
    if (wake.state !== EPodWake.Asleep) {
      list.push(
        global({
          chord: 'r',
          hint: 'wake',
          describe: 'wake the sandbox',
          group: EKeyGroup.Turn,
          run: () => {
            if (!composer.draftIsEmpty()) return false
            wake.handleWake()
            return true
          },
        }),
      )
    }
    return list
  }, [attention.handleRetry, attention.handleResume, composer, connection.cloudConnected, wake])

  const bindings = useMemo(
    () => [
      ...chatBindings({
        draftIsEmpty: composer.draftIsEmpty,
        onSubmit: composer.handleSubmit,
        onTakeBackPending: takeBack.handleTakeBack,
        onAttachImage: composer.handleAttachImage,
        onEscape: handleEscape,
      }),
      ...extra,
    ],
    [composer, extra, handleEscape, takeBack.handleTakeBack],
  )

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (operator.state !== null) return operator.handleKey(key)
      if (menu.handleKey(key)) return true
      if (composer.handleKey(key)) return true
      if (rewind.handleKey(key)) return true
      return chatPressHandled({ press: key, bindings, match: chordMatches })
    },
    [bindings, composer, menu, operator, rewind],
  )

  const onKeys = props.onKeys
  useEffect(() => {
    onKeys(handleKey)
  }, [handleKey, onKeys])

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
    />
  )
}
