import {
  activateSetting,
  adjustSetting,
  ESettingId,
  ESettingKind,
  ESettingPage,
  formatFavourites,
  type EUsageWindow,
  type ResolvedSetting,
  type SecretPrompt,
  type SettingValue,
} from '@dltech/atlas-core'
import type { SettingsWrite } from '@dltech/atlas-harness'
import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { appearanceOf, applyAppearance, type Appearance } from '../ui/appearance'
import { ESettingsLogin, type SettingsLoginState } from '../ui/settings-login-model'
import type { EFooterMeters } from '../ui/usage-meters'
import type { EThinkingVisibility } from '../store'
import {
  currentPage,
  currentRow,
  movePage,
  moveRow,
  openSettings,
  settingsModel,
  type SettingsModel,
  type SettingsState,
} from '../ui/settings-model'
import type { Span } from '../ui/components/spans'
import type { AtlasApp } from './compose'
import { preferencesOf } from './settings-preferences'
import { useAccountPage, type AccountPageControl } from './use-account-page'
import { useSecretPrompt } from './use-secret-prompt'
import { useSettingsCloudLogin } from './use-settings-cloud-login'

export type SettingsControl = {
  view: SettingsModel
  appearance: Appearance
  state: SettingsState | null
  prompt: SecretPrompt | null
  secretOf: (id: string) => Span | undefined
  secretOrigin: string
  origin: string
  problem: string | undefined
  cloudEmail: string | null
  cloudSignedIn: boolean
  cloudSignIn: SettingsLoginState
  account: AccountPageControl
  handleSignOut: () => void
  handleSignIn: () => void
  handleOpenSignInUrl: () => void
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
  const [cloudSession, setCloudSession] = useState<{ email: string | null } | null>(null)

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

  const write = useCallback(
    (target: SettingsState, next: (row: ResolvedSetting) => SettingValue) => {
      const row = currentRow({ state: target, model: view })
      if (row === undefined) return

      settle(app.settings.set({ id: row.definition.id, value: next(row) }))
    },
    [app.settings, settle, view],
  )

  const handleClearModel = useCallback(
    (target: SettingsState) => {
      const row = currentRow({ state: target, model: view })
      if (row === undefined || row.definition.kind !== ESettingKind.Model) return
      if (typeof row.value !== 'string' || row.value.length === 0) return

      settle(app.settings.clear({ id: row.definition.id }))
    },
    [app.settings, settle, view],
  )

  const readCloudSession = useCallback(() => {
    setCloudSession(app.cloud.session())
  }, [app.cloud])

  const handleOpen = useCallback(() => {
    readCloudSession()
    setState(openSettings())
  }, [readCloudSession])

  const handleSignOut = useCallback(() => {
    app.cloud.logout()
    readCloudSession()
  }, [app.cloud, readCloudSession])

  const cloudLogin = useSettingsCloudLogin({ cloud: app.cloud, openUrl: app.openUrl, onSignedIn: readCloudSession })

  const account = useAccountPage({
    cloud: app.cloud,
    loginStatus: cloudLogin.state.status,
    onSignOut: handleSignOut,
    onBeginSignIn: cloudLogin.begin,
    onSettled: readCloudSession,
  })

  const handleOpenSignInUrl = useCallback(() => {
    const url = cloudLogin.state.prompt?.url
    if (url === undefined || url.length === 0) return

    app.openUrl(url)
  }, [app, cloudLogin.state.prompt])

  const handlePinModels = useCallback(
    (favourites: readonly string[]) => {
      app.settings.set({
        id: ESettingId.ModelFavourites,
        value: formatFavourites(favourites),
      })
    },
    [app.settings],
  )

  const secret = useSecretPrompt({ secrets: app.secrets, resolution: held.resolution })

  const handleDismiss = useCallback(() => {
    setState(null)
    setRefused(null)
    secret.close()
    cloudLogin.stop()
    account.purge.handleDismiss()
  }, [account.purge, cloudLogin, secret])

  const handleSelect = useCallback((target: SettingsState) => {
    setState(target)
  }, [])

  const handleActivate = useCallback(
    (target: SettingsState) => {
      setState(target)

      if (currentPage({ state: target, model: view })?.page.id === ESettingPage.Account) {
        account.handleActivate()
        return
      }

      const row = currentRow({ state: target, model: view })
      if (row === undefined) return

      if (row.definition.kind === ESettingKind.Secret) {
        secret.open(row.definition.id)
        return
      }

      if (row.definition.kind === ESettingKind.Model) {
        onChooseModel(row.definition.id)
        return
      }

      write(target, (held) => activateSetting({ definition: held.definition, current: held.value }))
    },
    [account, onChooseModel, secret, view, write],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return
      key.preventDefault()

      if (secret.prompt !== null) {
        secret.handleKey(key, secret.prompt)
        return
      }

      const onAccountPage = currentPage({ state, model: view })?.page.id === ESettingPage.Account
      if (account.handleKey(key, { onAccountPage, signedIn: cloudSession !== null })) return

      if (key.name === 'escape') {
        handleDismiss()
        return
      }

      if (key.name === 'tab') {
        if (onAccountPage) cloudLogin.stop()
        account.handleResetAction()
        setState(movePage({ state, model: view, delta: key.shift ? -1 : 1 }))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        setState(moveRow({ state, model: view, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') {
        handleActivate(state)
        return
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        handleClearModel(state)
        return
      }

      if (key.name === 'left' || key.name === 'right') {
        write(state, (row) =>
          adjustSetting({
            definition: row.definition,
            current: row.value,
            delta: key.name === 'left' ? -1 : 1,
          }),
        )
      }
    },
    [
      account,
      cloudLogin,
      cloudSession,
      handleActivate,
      handleClearModel,
      handleDismiss,
      secret,
      state,
      view,
      write,
    ],
  )

  const preferences = useMemo(() => preferencesOf(held.resolution), [held.resolution])
  const problem = refused ?? held.problems[0]
  const origin = held.writesTo

  return useMemo(
    () => ({
      view,
      appearance,
      state,
      prompt: secret.prompt,
      secretOf: secret.displayOf,
      secretOrigin: secret.origin,
      origin,
      problem,
      cloudEmail: cloudSession?.email ?? null,
      cloudSignedIn: cloudSession !== null,
      cloudSignIn: cloudLogin.state,
      account,
      handleSignOut,
      handleSignIn: cloudLogin.begin,
      handleOpenSignInUrl,
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
      handleDismiss,
      handleKey,
      handleOpen,
      handleOpenSignInUrl,
      handlePinModels,
      handleSelect,
      handleSignOut,
      origin,
      preferences,
      problem,
      secret,
      state,
      view,
    ],
  )
}
