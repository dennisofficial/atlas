import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FollowedSessionList } from '@dltech/atlas-client/stream'
import { chordMatches } from '../ui/keys'

import { EPendingKind, type PendingRow } from '../store'
import { NoticeStack } from '../ui/components/notice-stack'
import { Threads } from '../ui/components/threads'
import { ENoticeTone, notify } from '../ui/notice-store'
import { isSettlingLogin } from '../ui/settings-login-model'
import type { ThreadRow } from '../ui/threads-model'
import {
  ACCOUNT_FILE_VERSION,
  deleteAccount,
  writeAccount,
  type AccountFile,
} from './account/account-file'
import { fetchSessionEmail, signOutSession } from './account/session-email'
import { useDeviceSignIn } from './account/use-device-sign-in'
import {
  EScreen,
  screenOfAccount,
  screenOnAuthLost,
  screenOnBack,
  screenOnPick,
  type ScreenState,
} from './app-screen'
import { AwaitingAccessScreen } from './awaiting-access-screen'
import { chatBindings, chatPressHandled } from './chat-bindings'
import { ChatScreen } from './chat-screen'
import { createSessionClient, type AuthRefusal, type SessionClient } from './session-client'
import { SignInScreen } from './sign-in-screen'
import { useSessionAttachments } from './use-session-attachments'
import { useSessionComposer } from './use-session-composer'
import { useSessionList } from './use-session-list'
import { useSessionSend } from './use-session-send'
import { useSessionTranscript } from './use-session-transcript'
import { useStagedMessages } from './staged-messages'

export type SessionClientArgs = {
  apiUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
  onAuthLost: (status: AuthRefusal) => void
}

export type SessionClientFactory = (args: SessionClientArgs) => SessionClient

export type AppNextProps = {
  accountPath: string
  initialAccount: AccountFile | null
  apiUrl: string
  clientVersion: string
  openUrl: (url: string) => void
  fetchFn?: typeof fetch | undefined
  now?: (() => number) | undefined
  createClient?: SessionClientFactory | undefined
  onQuit: () => void
}

const EMPTY_SESSION_LIST: FollowedSessionList = {
  getSnapshot: () => [],
  subscribe: () => () => undefined,
  close: () => undefined,
}

const isEnter = (key: KeyEvent): boolean => key.name === 'return' || key.name === 'enter'

export function AppNext(props: AppNextProps): React.ReactNode {
  const [account, setAccount] = useState<AccountFile | null>(props.initialAccount)
  const [screen, setScreen] = useState<ScreenState>(() =>
    screenOfAccount({ account: props.initialAccount }),
  )
  const { width, height } = useTerminalDimensions()
  const now = useMemo(() => props.now ?? Date.now, [props.now])

  const held = useRef<AccountFile | null>(account)
  held.current = account

  const handleAuthLost = useCallback(
    (status: AuthRefusal) => {
      if (status === 403) {
        setScreen(screenOnAuthLost({ status, email: held.current?.email ?? null }))
        return
      }
      deleteAccount({ path: props.accountPath })
      setAccount(null)
      setScreen(screenOnAuthLost({ status, email: null }))
    },
    [props.accountPath],
  )

  const handleApproved = useCallback(
    async (result: { token: string }) => {
      const email = await fetchSessionEmail({
        apiUrl: props.apiUrl,
        token: result.token,
        fetchFn: props.fetchFn,
      })
      const next: AccountFile = {
        version: ACCOUNT_FILE_VERSION,
        apiUrl: props.apiUrl,
        email,
        token: result.token,
        preferences: {},
      }
      writeAccount({ path: props.accountPath, account: next })
      setAccount(next)
      setScreen(screenOfAccount({ account: next }))
    },
    [props.accountPath, props.apiUrl, props.fetchFn],
  )

  const signIn = useDeviceSignIn({
    apiUrl: props.apiUrl,
    openUrl: props.openUrl,
    fetchFn: props.fetchFn,
    onApproved: handleApproved,
  })

  const makeClient = useMemo(() => props.createClient ?? createSessionClient, [props.createClient])

  const client = useMemo(
    () =>
      account === null
        ? null
        : makeClient({
            apiUrl: account.apiUrl,
            token: account.token,
            clientVersion: props.clientVersion,
            ...(props.fetchFn === undefined ? {} : { fetchFn: props.fetchFn }),
            onAuthLost: handleAuthLost,
          }),
    [account, handleAuthLost, makeClient, props.clientVersion, props.fetchFn],
  )

  useEffect(() => () => client?.close(), [client])

  const clientHeld = useRef<SessionClient | null>(client)
  clientHeld.current = client

  const follow = useCallback(
    () => clientHeld.current?.connection.followSessions() ?? EMPTY_SESSION_LIST,
    [],
  )

  const handlePick = useCallback((row: ThreadRow) => setScreen(screenOnPick({ row })), [])

  const handleSignOut = useCallback(async () => {
    const open = held.current
    if (open !== null)
      await signOutSession({ apiUrl: open.apiUrl, token: open.token, fetchFn: props.fetchFn })
    deleteAccount({ path: props.accountPath })
    setAccount(null)
    setScreen({ screen: EScreen.SignIn, reason: null })
  }, [props.accountPath, props.fetchFn])

  const list = useSessionList({ follow, onPick: handlePick, now })

  const chatKeys = useRef<((key: KeyEvent) => boolean) | null>(null)

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (key.ctrl && key.name === 'c') {
        props.onQuit()
        return
      }

      switch (screen.screen) {
        case EScreen.SignIn:
          if (isEnter(key) && !isSettlingLogin(signIn.state.status)) signIn.begin()
          else if (key.name === 'escape') signIn.stop()
          return
        case EScreen.AwaitingAccess:
          if (key.name === 's') void handleSignOut()
          return
        case EScreen.Sessions:
          if (key.name === 'escape') props.onQuit()
          else list.handleKey(key)
          return
        case EScreen.Transcript:
          chatKeys.current?.(key)
          return
      }
    },
    [handleSignOut, list, props, screen, signIn],
  )

  useKeyboard(handleKey)

  if (screen.screen === EScreen.SignIn) {
    return (
      <SignInScreen
        width={width}
        state={signIn.state}
        reason={screen.reason}
        onSignIn={signIn.begin}
        onOpenUrl={props.openUrl}
      />
    )
  }

  if (screen.screen === EScreen.AwaitingAccess) {
    return (
      <AwaitingAccessScreen
        width={width}
        email={screen.email}
        onSignOut={() => void handleSignOut()}
      />
    )
  }

  if (screen.screen === EScreen.Transcript) {
    if (client === null) return null
    return (
      <ChatScreenHost
        client={client}
        sessionId={screen.sessionId}
        title={screen.title}
        width={width}
        height={height}
        now={now}
        onBack={() => setScreen(screenOnBack())}
        onKeys={(handler) => {
          chatKeys.current = handler
        }}
      />
    )
  }

  return (
    <box flexDirection="column" flexGrow={1} width={width}>
      <box flexGrow={1} />
      <Threads
        width={width}
        state={list.state}
        onPick={list.handlePick}
        onDismiss={props.onQuit}
        onQueryChange={list.handleQuery}
      />
      <NoticeStack width={width} />
    </box>
  )
}

const problemOf = (reason: string): void => {
  notify({ text: reason, tone: ENoticeTone.Warn })
}

function ChatScreenHost(props: {
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
