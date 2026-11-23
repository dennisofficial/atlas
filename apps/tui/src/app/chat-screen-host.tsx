import type { KeyEvent } from '@opentui/core'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'

import { EPendingKind, type PendingRow } from '../store'
import { chordMatches } from '../ui/keys'
import { ENoticeTone, notify } from '../ui/notice-store'
import { chatBindings, chatPressHandled } from './chat-bindings'
import { ChatScreen } from './chat-screen'
import type { SessionClient } from './session-client'
import { useStagedMessages } from './staged-messages'
import { useSessionAttachments } from './use-session-attachments'
import { useSessionComposer } from './use-session-composer'
import { useSessionSend } from './use-session-send'
import { useSessionTranscript } from './use-session-transcript'

const problemOf = (reason: string): void => {
  notify({ text: reason, tone: ENoticeTone.Warn })
}

export function ChatScreenHost(props: {
  client: SessionClient
  sessionId: string
  title: string | null
  width: number
  height: number
  now: () => number
  onBack: () => void
  onKeys: (handler: (key: KeyEvent) => boolean) => void
}): React.ReactNode {
  const transcript = useSessionTranscript({
    client: props.client,
    sessionId: props.sessionId,
    title: props.title,
    now: props.now,
  })

  const restore = useRef<(args: { text: string; reason: string | undefined }) => void>(
    () => undefined,
  )

  const staged = useStagedMessages({
    sessionId: props.sessionId,
    events: transcript.rawEvents,
    working: transcript.working,
    onRestore: (args) => restore.current(args),
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
  })

  restore.current = (args: { text: string; reason: string | undefined }) => {
    composer.tokens.restore({ text: args.text, images: [] })
    if (args.reason !== undefined) problemOf(args.reason)
  }

  const pending = useMemo<readonly PendingRow[]>(
    () =>
      [...staged.transcript, ...staged.queue].map((message) => ({
        kind: EPendingKind.Sending,
        id: message.clientId,
        text: message.text,
        failed: staged.failed.has(message.clientId),
      })),
    [staged.queue, staged.transcript, staged.failed],
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

  const bindings = useMemo(
    () =>
      chatBindings({
        draftIsEmpty: composer.draftIsEmpty,
        onSubmit: composer.handleSubmit,
        onTakeBackPending: composer.handleTakeBackPending,
        onAttachImage: composer.handleAttachImage,
        onEscape: handleEscape,
      }),
    [composer, handleEscape, transcript.working],
  )

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (composer.handleKey(key)) return true
      return chatPressHandled({ press: key, bindings, match: chordMatches })
    },
    [bindings, composer],
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
      width={props.width}
      height={props.height}
      cwd="/"
      now={props.now()}
      sends={send.sends}
      working={transcript.working}
    />
  )
}
