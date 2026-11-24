import {
  ATLAS_SETTINGS,
  ESettingPage,
  type SettingDefinition,
  type SettingValue,
  type SettingsResolution,
} from '@dltech/atlas-core'
import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Appearance } from '../ui/appearance'
import type { GithubAccountView } from '../ui/components/settings/github-connect'
import type { SigningKeyAccountView } from '../ui/components/settings/signing-key-row'
import {
  currentPage,
  openSettings,
  settingsModel,
  type SettingsModel,
  type SettingsState,
} from '../ui/settings-model'
import type { AccountSettings } from './use-account-settings'
import { useAccountSettingsKeys } from './use-account-settings-keys'
import type { CloudPageControl } from './use-cloud-page'
import { useSecretPrompt, type SecretPromptControl } from './use-secret-prompt'
import type { SecretControl } from './use-secrets'
import { useTextPrompt, type TextPromptControl } from './use-text-prompt'
import { drawerDefinitionsOf } from './settings-values'

export type SettingsDrawer = {
  state: SettingsState | null
  view: SettingsModel
  resolution: SettingsResolution
  appearance: Appearance
  secret: SecretPromptControl
  text: TextPromptControl
  cloud: CloudPageControl
  cloudEmail: string | null
  github: GithubAccountView
  signingKey: SigningKeyAccountView
  origin: string
  secretOrigin: string
  problem: string | undefined
  select: (target: SettingsState) => void
  signOut: () => void
  open: () => void
  close: () => void
  handleKey: (key: KeyEvent) => boolean
}

export function useSettingsDrawer(args: {
  settings: AccountSettings
  secrets: SecretControl
  cloud: CloudPageControl
  github: GithubAccountView & { refresh: () => void; stop: () => void }
  signingKey: SigningKeyAccountView
  appearance: Appearance
  email: string | null
  onChooseModel: (id: string) => void
  onSignOut: () => void
}): SettingsDrawer {
  const { settings, secrets, cloud, github, appearance } = args
  const [state, setState] = useState<SettingsState | null>(null)
  const resolution = settings.resolution

  const view = useMemo(
    () => settingsModel({ definitions: drawerDefinitionsOf(ATLAS_SETTINGS), resolution }),
    [resolution],
  )

  const secret = useSecretPrompt({ secrets, resolution })
  const commitText = useCallback(
    (written: { id: string; value: string }): Promise<boolean> => {
      const definition = ATLAS_SETTINGS.find((held) => held.id === written.id)
      return definition === undefined
        ? Promise.resolve(false)
        : settings.set({ definition, value: written.value })
    },
    [settings],
  )
  const text = useTextPrompt({ commit: commitText })

  const write = useCallback(
    (written: { definition: SettingDefinition; value: SettingValue }) => {
      void settings.set(written)
    },
    [settings],
  )

  const clear = useCallback(
    (cleared: { definition: SettingDefinition }) => {
      void settings.set({ definition: cleared.definition, value: cleared.definition.fallback })
    },
    [settings],
  )

  const close = useCallback(() => {
    setState(null)
    secret.close()
    text.close()
    cloud.handleResetAction()
    github.stop()
  }, [cloud, github, secret, text])

  const open = useCallback(() => {
    secret.refresh()
    setState(openSettings())
  }, [secret])

  const select = useCallback((target: SettingsState) => {
    setState(target)
  }, [])

  const { handleKey: handleDrawerKey } = useAccountSettingsKeys({
    view,
    state,
    resolution,
    select,
    write,
    clear,
    secret,
    text,
    cloudPage: cloud,
    onChooseModel: args.onChooseModel,
    onDismiss: close,
  })

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (state === null) return false
      handleDrawerKey(key)
      return true
    },
    [handleDrawerKey, state],
  )

  const onCloudPage =
    state !== null && currentPage({ state, model: view })?.page.id === ESettingPage.Cloud
  const refreshGithub = github.refresh

  useEffect(() => {
    if (onCloudPage) refreshGithub()
  }, [onCloudPage, refreshGithub])

  return useMemo(
    () => ({
      state,
      view,
      resolution,
      appearance,
      secret,
      text,
      cloud,
      cloudEmail: args.email,
      github,
      signingKey: args.signingKey,
      origin: 'your account',
      secretOrigin: secret.origin,
      problem: settings.problem,
      select,
      signOut: args.onSignOut,
      open,
      close,
      handleKey,
    }),
    [
      appearance,
      args.email,
      args.onSignOut,
      args.signingKey,
      close,
      cloud,
      github,
      handleKey,
      open,
      resolution,
      secret,
      select,
      settings.problem,
      state,
      text,
      view,
    ],
  )
}
