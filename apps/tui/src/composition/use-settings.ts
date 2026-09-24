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
import type { CloudSyncState } from '../ui/components/settings/cloud'
import type { AtlasApp } from './compose'
import { preferencesOf } from './settings-preferences'
import { type CloudPageControl } from './use-cloud-page'
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
  cloudPage: CloudPageControl
  cloudUpload: CloudSyncState
  cloudDownload: CloudSyncState
  github: SettingsGithubControl
  handleSignOut: () => void
  handleSignIn: () => void
  handleUpload: () => void
  handleDownload: () => void
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
    cloudPage,
    github,
    upload: cloudUpload,
    download: cloudDownload,
    readSession: readCloudSession,
    handleSignOut,
    handleUpload,
    handleDownload,
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
  }, [cloudLogin, github, secret, text])

  const onCloudPage =
    state !== null && currentPage({ state, model: view })?.page.id === ESettingPage.Cloud

  useEffect(() => {
    if (onCloudPage) github.refresh()
  }, [onCloudPage, cloudSession, github.refresh])

  const handleSelect = useCallback(
    (target: SettingsState) => {
      cloudPage.handleDisarmAction()
      setState(target)
    },
    [cloudPage],
  )

  const { handleKey } = useSettingsKeys({
    app,
    view,
    state,
    select: setState,
    settle,
    secret,
    text,
    cloudPage,
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
      cloudPage,
      cloudUpload,
      cloudDownload,
      github,
      handleSignOut,
      handleSignIn: cloudLogin.begin,
      handleUpload,
      handleDownload,
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
      appearance,
      cloudDownload,
      cloudLogin.begin,
      cloudLogin.state,
      cloudPage,
      cloudSession,
      cloudUpload,
      github,
      handleDismiss,
      handleDownload,
      handleKey,
      handleOpen,
      handleOpenGithubUrl,
      handleOpenSignInUrl,
      handlePinModels,
      handleSelect,
      handleSignOut,
      handleUpload,
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
