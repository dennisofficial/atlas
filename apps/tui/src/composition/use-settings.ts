import {
  ESettingId,
  ESettingPage,
  formatFavourites,
  type EUsageWindow,
  type SecretPrompt,
  type TextPrompt,
} from '@dltech/atlas-core'
import type { SettingsWrite } from '@dltech/atlas-harness'
import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { appearanceOf, applyAppearance, type Appearance } from '../ui/appearance'
import { type SettingsLoginState } from '../ui/settings-login-model'
import type { EFooterMeters } from '../ui/usage-meters'
import type { EThinkingVisibility } from '../store'
import {
  currentPage,
  openSettings,
  settingsModel,
  type SettingsModel,
  type SettingsState,
} from '../ui/settings-model'
import type { Span } from '../ui/components/spans'
import type { AtlasApp } from './compose'
import { preferencesOf } from './settings-preferences'
import { type AccountPageControl } from './use-account-page'
import { useSecretPrompt } from './use-secret-prompt'
import { type SettingsGithubControl } from './use-settings-github'
import { useSettingsCloud } from './use-settings-cloud'
import { useTextPrompt } from './use-text-prompt'
import { useSettingsKeys } from './use-settings-keys'

export type SettingsControl = {
  view: SettingsModel
  appearance: Appearance
  state: SettingsState | null
  prompt: SecretPrompt | null
  textPrompt: TextPrompt | null
  secretOf: (id: string) => Span | undefined
  secretOrigin: string
  origin: string
  problem: string | undefined
  cloudEmail: string | null
  cloudSignedIn: boolean
  cloudSignIn: SettingsLoginState
  account: AccountPageControl
  github: SettingsGithubControl
  handleSignOut: () => void
  handleSignIn: () => void
  handleOpenSignInUrl: () => void
  handleOpenGithubUrl: () => void
  sidebarWidth: number
  sidebarFoldBelow: number
  autoCompactAtPercent: number
  autoRestart: boolean
  noticeSeconds: number
  paceReveal: boolean
  thinking: EThinkingVisibility
  tldrStatus: boolean
  footerMeters: EFooterMeters
  usageWarn: Record<EUsageWindow, number>
  modelFavourites: readonly string[]
  handlePinModels: (favourites: readonly string[]) => void
  handleOpen: () => void
  handleDismiss: () => void
  handleSelect: (target: SettingsState) => void
  handleKey: (key: KeyEvent) => void
}

export function useSettings(args: {
  app: AtlasApp
  onChooseModel: (id: string) => void
}): SettingsControl {
  const { app, onChooseModel } = args
  useSyncExternalStore(app.settings.subscribe, app.settings.version)
  const held = app.settings.snapshot()

  const [state, setState] = useState<SettingsState | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  const view = useMemo(
    () => settingsModel({ definitions: app.settings.definitions, resolution: held.resolution }),
    [app.settings.definitions, held.resolution],
  )

  const { accent, density, composer, imageRows, fenceWrap } = appearanceOf({
    resolution: held.resolution,
  })

  const appearance = useMemo(
    () => ({ accent, density, composer, imageRows, fenceWrap }),
    [accent, composer, density, imageRows, fenceWrap],
  )

  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  const settle = useCallback((result: SettingsWrite) => {
    setRefused(result.ok ? null : result.message)
  }, [])

  const secret = useSecretPrompt({ secrets: app.secrets, resolution: held.resolution })
  const text = useTextPrompt({ settings: app.settings, settle })

  const rewarmSecrets = useCallback(() => {
    void app
      .rewarmSecrets()
      .then(secret.refresh)
      .catch(() => undefined)
  }, [app, secret.refresh])

  const {
    session: cloudSession,
    login: cloudLogin,
    account,
    github,
    readSession: readCloudSession,
    handleSignOut,
    handleOpenSignInUrl,
    handleOpenGithubUrl,
  } = useSettingsCloud({ cloud: app.cloud, openUrl: app.openUrl, onSignedIn: rewarmSecrets })

  const handleOpen = useCallback(() => {
    readCloudSession()
    rewarmSecrets()
    setState(openSettings())
  }, [readCloudSession, rewarmSecrets])

  const handlePinModels = useCallback(
    (favourites: readonly string[]) => {
      app.settings.set({
        id: ESettingId.ModelFavourites,
        value: formatFavourites(favourites),
      })
    },
    [app.settings],
  )

  const handleDismiss = useCallback(() => {
    setState(null)
    setRefused(null)
    secret.close()
    text.close()
    cloudLogin.stop()
    github.stop()
    account.purge.handleDismiss()
  }, [account.purge, cloudLogin, github, secret, text])

  const onAccountPage =
    state !== null && currentPage({ state, model: view })?.page.id === ESettingPage.Account

  useEffect(() => {
    if (onAccountPage) github.refresh()
  }, [onAccountPage, cloudSession, github.refresh])

  const handleSelect = useCallback((target: SettingsState) => {
    setState(target)
  }, [])

  const { handleKey } = useSettingsKeys({
    app,
    view,
    state,
    select: setState,
    settle,
    secret,
    text,
    account,
    login: cloudLogin,
    github,
    signedIn: cloudSession !== null,
    onChooseModel,
    onDismiss: handleDismiss,
  })

  const preferences = useMemo(() => preferencesOf(held.resolution), [held.resolution])
  const problem = refused ?? held.problems[0]
  const origin = held.writesTo

  return useMemo(
    () => ({
      view,
      appearance,
      state,
      prompt: secret.prompt,
      textPrompt: text.prompt,
      secretOf: secret.displayOf,
      secretOrigin: secret.origin,
      origin,
      problem,
      cloudEmail: cloudSession?.email ?? null,
      cloudSignedIn: cloudSession !== null,
      cloudSignIn: cloudLogin.state,
      account,
      github,
      handleSignOut,
      handleSignIn: cloudLogin.begin,
      handleOpenSignInUrl,
      handleOpenGithubUrl,
      ...preferences,
      handlePinModels,
      handleOpen,
      handleDismiss,
      handleSelect,
      handleKey,
    }),
    [
      account,
      appearance,
      cloudLogin.begin,
      cloudLogin.state,
      cloudSession,
      github,
      handleDismiss,
      handleKey,
      handleOpen,
      handleOpenGithubUrl,
      handleOpenSignInUrl,
      handlePinModels,
      handleSelect,
      handleSignOut,
      origin,
      preferences,
      problem,
      secret,
      state,
      text,
      view,
    ],
  )
}
