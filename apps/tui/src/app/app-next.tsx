import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SessionModelChoice, StreamSessionRow } from '@dltech/atlas-protocol'

import { NoticeStack } from '../ui/components/notice-stack'
import { Threads } from '../ui/components/threads'
import { isSettlingLogin } from '../ui/settings-login-model'
import type { SwitcherChoice } from '../ui/switcher-model'
import type { AccountFile } from './account/account-file'
import {
  DEFAULT_LAUNCH,
  EMPTY_SESSION_LIST,
  isEnter,
  modelOfRef,
  modelPickOf,
  problemOf,
} from './app-next-support'
import {
  EScreen,
  screenOfAccount,
  screenOnBack,
  screenOnCreated,
  screenOnNew,
  type ScreenState,
} from './app-screen'
import { AwaitingAccessScreen } from './awaiting-access-screen'
import { ChatScreenHost } from './chat-screen-host'
import type { LaunchFlags } from './launch-flags'
import { ModelSwitcher } from './model-switcher'
import type { GitRemote } from './new-session'
import { NewSessionHost } from './new-session-host'
import { createSessionClient, type AuthRefusal, type SessionClient } from './session-client'
import { SignInScreen } from './sign-in-screen'
import { useAccountFlow } from './use-account-flow'
import { useModelChoice } from './use-model-choice'
import { useSessionNav } from './use-session-nav'
import { useSessionList } from './use-session-list'
import { useSessionModels } from './use-session-models'
import { useAppSessionWatch } from './use-app-session-watch'

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
  launch?: LaunchFlags | undefined
  cwd?: string | undefined
  git?: GitRemote | undefined
  fetchFn?: typeof fetch | undefined
  now?: (() => number) | undefined
  createClient?: SessionClientFactory | undefined
  onQuit: () => void
}

export function AppNext(props: AppNextProps): React.ReactNode {
  const [screen, setScreen] = useState<ScreenState>(() =>
    screenOfAccount({ account: props.initialAccount }),
  )
  const { width, height } = useTerminalDimensions()
  const now = useMemo(() => props.now ?? Date.now, [props.now])
  const launch = props.launch ?? DEFAULT_LAUNCH
  const cwd = props.cwd ?? process.cwd()

  const { account, handleAuthLost, signIn, handleSignOut } = useAccountFlow({
    accountPath: props.accountPath,
    apiUrl: props.apiUrl,
    initialAccount: props.initialAccount,
    openUrl: props.openUrl,
    ...(props.fetchFn === undefined ? {} : { fetchFn: props.fetchFn }),
    onScreen: setScreen,
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
  const watching = screen.screen === EScreen.Transcript ? screen.sessionId : null

  const clientHeld = useRef<SessionClient | null>(client)
  clientHeld.current = client
  const follow = useCallback(
    () => clientHeld.current?.connection.followSessions() ?? EMPTY_SESSION_LIST,
    [],
  )
  const lookupModel = useRef<(sessionId: string) => SessionModelChoice | null>(() => null)

  const initialModel = launch.model === null ? null : modelOfRef(launch.model)

  const models = useSessionModels({ api: client?.api ?? null, onProblem: problemOf })

  const canPickModel = screen.screen === EScreen.Transcript || screen.screen === EScreen.NewSession
  const currentModel: SessionModelChoice | null = canPickModel ? screen.model : initialModel

  const handleModelPick = useCallback(
    (picked: SwitcherChoice) => {
      const next = modelPickOf({
        screen,
        picked,
        api: clientHeld.current?.api ?? null,
        onProblem: problemOf,
      })
      if (next !== null) setScreen(next)
    },
    [screen],
  )

  const choice = useModelChoice({
    catalogue: models.providers,
    reachable: models.reachable,
    active: currentModel,
    onPick: handleModelPick,
  })

  const rowOfRef = useRef<(sessionId: string) => StreamSessionRow | undefined>(() => undefined)

  const nav = useSessionNav({
    screen,
    setScreen,
    modelOf: (sessionId) => lookupModel.current(sessionId),
    titleOf: (sessionId) => rowOfRef.current(sessionId)?.title ?? null,
  })

  const list = useSessionList({
    follow,
    onPick: nav.handlePick,
    now,
    pendingOpen: launch.open,
    onProblem: problemOf,
  })
  lookupModel.current = list.modelOf
  rowOfRef.current = list.rowOf
  useAppSessionWatch({ api: client?.api ?? null, sessionId: watching, rows: list.rows })

  const chatKeys = useRef<((key: KeyEvent) => boolean) | null>(null)
  const newKeys = useRef<((key: KeyEvent) => boolean) | null>(null)

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (key.ctrl && key.name === 'c') {
        props.onQuit()
        return
      }

      if (key.ctrl && key.name === 'p' && canPickModel) {
        choice.handleOpen()
        return
      }

      if (key.ctrl && key.name === 'n') {
        if (screen.screen === EScreen.Sessions || screen.screen === EScreen.Transcript)
          setScreen(screenOnNew({ model: initialModel }))
        return
      }

      if (choice.handleKey(key)) return

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
        case EScreen.NewSession:
          newKeys.current?.(key)
          return
      }
    },
    [canPickModel, choice, handleSignOut, initialModel, list, props, screen, signIn],
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

  const switcher = <ModelSwitcher choice={choice} width={width} />

  if (screen.screen === EScreen.Transcript) {
    if (client === null) return null
    return (
      <box flexDirection="column" flexGrow={1} width={width}>
        <ChatScreenHost
          client={client}
          sessionId={screen.sessionId}
          title={screen.title}
          width={width}
          height={height}
          now={now}
          cwd={cwd}
          onBack={nav.handleBack}
          onNew={() => setScreen(screenOnNew({ model: currentModel }))}
          onModel={choice.handleOpen}
          onQuit={props.onQuit}
          onKeys={(handler) => {
            chatKeys.current = handler
          }}
          choosingModel={choice.state !== null}
          clientVersion={props.clientVersion}
          teammates={list.rows}
          row={list.rowOf(screen.sessionId)}
          openUrl={props.openUrl}
          onOpenSession={nav.handleOpenSession}
        />
        {switcher}
      </box>
    )
  }

  if (screen.screen === EScreen.NewSession) {
    if (client === null) return null
    return (
      <box flexDirection="column" flexGrow={1} width={width}>
        <NewSessionHost
          client={client}
          cwd={cwd}
          model={screen.model}
          width={width}
          height={height}
          choosingModel={choice.state !== null}
          {...(props.git === undefined ? {} : { git: props.git })}
          onBack={() => setScreen(screenOnBack())}
          onCreated={(created) => setScreen(screenOnCreated(created))}
          onKeys={(handler) => {
            newKeys.current = handler
          }}
        />
        {switcher}
      </box>
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
