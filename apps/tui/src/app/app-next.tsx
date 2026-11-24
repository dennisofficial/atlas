import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SessionModelChoice, StreamSessionRow } from '@dltech/atlas-protocol'

import { isSettlingLogin } from '../ui/settings-login-model'
import { DEFAULT_LAUNCH, EMPTY_SESSION_LIST, isEnter, problemOf } from './app-next-support'
import {
  EScreen,
  screenOfAccount,
  screenOnBack,
  screenOnCreated,
  screenOnNew,
  type ScreenState,
} from './app-screen'
import { AccessScreen } from './access-screen'
import { OverlaysScreen } from './app-overlays'
import { ChatScreenHost } from './chat-screen-host'
import { ModelSwitcher } from './model-switcher'
import { NewSessionHost } from './new-session-host'
import { createSessionClient, type SessionClient } from './session-client'
import { SessionsScreen } from './sessions-screen'
import { useAccountFlow } from './use-account-flow'
import { useAppOverlays } from './use-app-overlays'
import { initialModelOf, useAppModelPick } from './use-app-model-pick'
import { useSessionNav } from './use-session-nav'
import { useSessionList } from './use-session-list'
import { useSessionModels } from './use-session-models'
import { useSettingsPanel, type SettingsPanel } from './use-settings-panel'
import { useAppSessionWatch } from './use-app-session-watch'
import { useUpdateCheck } from './use-update-check'

import type { AppNextProps } from './app-next-props'

export type { AppNextProps, SessionClientArgs, SessionClientFactory } from './app-next-props'

export function AppNext(props: AppNextProps): React.ReactNode {
  const [screen, setScreen] = useState<ScreenState>(() =>
    screenOfAccount({ account: props.initialAccount }),
  )
  const { width, height } = useTerminalDimensions()
  const now = useMemo(() => props.now ?? Date.now, [props.now])
  const launch = props.launch ?? DEFAULT_LAUNCH
  const cwd = props.cwd ?? process.cwd()

  const {
    account,
    handleAuthLost,
    handlePreferences,
    handleRememberSession,
    signIn,
    handleSignOut,
  } = useAccountFlow({
    accountPath: props.accountPath,
    apiUrl: props.apiUrl,
    initialAccount: props.initialAccount,
    openUrl: props.openUrl,
    ...(props.fetchFn === undefined ? {} : { fetchFn: props.fetchFn }),
    onScreen: setScreen,
  })

  const makeClient = useMemo(() => props.createClient ?? createSessionClient, [props.createClient])
  const apiUrl = account?.apiUrl ?? null
  const token = account?.token ?? null

  const client = useMemo(
    () =>
      apiUrl === null || token === null
        ? null
        : makeClient({
            apiUrl,
            token,
            clientVersion: props.clientVersion,
            ...(props.fetchFn === undefined ? {} : { fetchFn: props.fetchFn }),
            onAuthLost: handleAuthLost,
          }),
    [apiUrl, token, handleAuthLost, makeClient, props.clientVersion, props.fetchFn],
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

  const initialModel = initialModelOf(launch.model)
  const models = useSessionModels({ api: client?.api ?? null, onProblem: problemOf })
  const panelWrite = useRef<SettingsPanel['write'] | null>(null)

  const pick = useAppModelPick({
    models,
    screen,
    initialModel,
    api: () => clientHeld.current?.api ?? null,
    onScreen: setScreen,
    writeSetting: (written) => void panelWrite.current?.(written),
  })

  const panel = useSettingsPanel({
    api: client?.api ?? null,
    preferences: account?.preferences ?? {},
    email: account?.email ?? null,
    openUrl: props.openUrl,
    onPreferences: handlePreferences,
    onSignOut: () => void handleSignOut(),
    onProblem: problemOf,
    onChooseModel: pick.chooseSetting,
  })
  panelWrite.current = panel.write

  const overlays = useAppOverlays({
    api: client?.api ?? null,
    openUrl: props.openUrl,
    onChanged: models.reload,
    onProblem: problemOf,
    resolution: panel.drawer.resolution,
    onChooseModel: pick.chooseSetting,
    settingsOpen: panel.drawer.state !== null,
    handleSettingsKey: panel.drawer.handleKey,
    openSettings: panel.drawer.open,
  })

  const rowOfRef = useRef<(sessionId: string) => StreamSessionRow | undefined>(() => undefined)

  const nav = useSessionNav({
    screen,
    setScreen,
    modelOf: (sessionId) => lookupModel.current(sessionId),
    titleOf: (sessionId) => rowOfRef.current(sessionId)?.title ?? null,
  })

  const watch = useAppSessionWatch({ api: client?.api ?? null, sessionId: watching })

  const list = useSessionList({
    follow,
    onPick: nav.handlePick,
    now,
    pendingOpen: launch.open,
    lastSessionId: props.initialAccount?.lastSessionId ?? null,
    onProblem: problemOf,
    onRows: watch,
  })
  lookupModel.current = list.modelOf
  rowOfRef.current = list.rowOf

  useUpdateCheck({
    ready: screen.screen !== EScreen.SignIn && screen.screen !== EScreen.AwaitingAccess,
    accountPath: props.accountPath,
    check: props.checkUpdate,
  })

  const openedSessionId = screen.screen === EScreen.Transcript ? screen.sessionId : null

  useEffect(() => {
    if (openedSessionId !== null) handleRememberSession(openedSessionId)
  }, [handleRememberSession, openedSessionId])

  const chatKeys = useRef<((key: KeyEvent) => boolean) | null>(null)
  const newKeys = useRef<((key: KeyEvent) => boolean) | null>(null)

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (key.ctrl && key.name === 'c') {
        props.onQuit()
        return
      }

      if (pick.choice.handleKey(key)) return

      if (overlays.handleKey(key)) return

      if (key.ctrl && key.name === 'p' && pick.canPickModel) {
        pick.choice.handleOpen()
        return
      }

      if (key.ctrl && key.name === 'n') {
        if (screen.screen === EScreen.Sessions || screen.screen === EScreen.Transcript)
          setScreen(screenOnNew({ model: initialModel }))
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
        case EScreen.NewSession:
          newKeys.current?.(key)
          return
      }
    },
    [handleSignOut, initialModel, list, overlays, panel, pick, props, screen, signIn],
  )

  useKeyboard(handleKey)

  if (screen.screen === EScreen.SignIn || screen.screen === EScreen.AwaitingAccess) {
    return (
      <AccessScreen
        screen={screen}
        width={width}
        signIn={signIn}
        openUrl={props.openUrl}
        onSignOut={() => void handleSignOut()}
      />
    )
  }

  const switcher = <ModelSwitcher choice={pick.choice} width={width} />

  const withOverlay = (body: React.ReactNode): React.ReactNode => (
    <box flexDirection="column" flexGrow={1} width={width}>
      {body}
      <OverlaysScreen
        width={width}
        cwd={cwd}
        drawer={panel.drawer}
        sidebarWidth={panel.sidebarWidth}
        accounts={overlays.accounts}
        onboarding={overlays.onboarding}
        shown={overlays.shown}
      />
    </box>
  )

  if (screen.screen === EScreen.Transcript) {
    if (client === null) return null
    return withOverlay(
      <>
        <ChatScreenHost
          client={client}
          sessionId={screen.sessionId}
          title={screen.title}
          width={width}
          height={height}
          now={now}
          cwd={cwd}
          onBack={nav.handleBack}
          onNew={() => setScreen(screenOnNew({ model: pick.currentModel }))}
          onModel={pick.choice.handleOpen}
          onQuit={props.onQuit}
          onKeys={(handler) => {
            chatKeys.current = handler
          }}
          choosingModel={pick.choice.state !== null}
          clientVersion={props.clientVersion}
          teammates={list.rows}
          row={list.rowOf(screen.sessionId)}
          openUrl={props.openUrl}
          onOpenSession={nav.handleOpenSession}
          onSettings={overlays.openSettings}
          onAuth={overlays.openAccounts}
        />
        {switcher}
      </>,
    )
  }

  if (screen.screen === EScreen.NewSession) {
    if (client === null) return null
    return withOverlay(
      <>
        <NewSessionHost
          client={client}
          cwd={cwd}
          model={screen.model}
          width={width}
          height={height}
          choosingModel={pick.choice.state !== null}
          {...(props.git === undefined ? {} : { git: props.git })}
          onBack={() => setScreen(screenOnBack())}
          onCreated={(created) => setScreen(screenOnCreated(created))}
          onKeys={(handler) => {
            newKeys.current = handler
          }}
        />
        {switcher}
      </>,
    )
  }

  return withOverlay(<SessionsScreen width={width} list={list} onDismiss={props.onQuit} />)
}
