import {
  ATLAS_SETTINGS,
  ESettingId,
  rangeValueOf,
  type SettingDefinition,
  type SettingValue,
} from '@dltech/atlas-core'
import { useEffect, useMemo } from 'react'

import { hasSigningKey } from '../ui/components/settings/signing-key-row'
import { applySidebarWidth } from '../ui/sidebar-width-store'
import { SIDEBAR_WIDTH } from '../ui/theme'
import type { SessionApi } from './session-api'
import { useAccountSettings } from './use-account-settings'
import { useAppearance } from './use-appearance'
import { useCloudPage } from './use-cloud-page'
import { useGithubConnect } from './use-github-connect'
import { useSecrets } from './use-secrets'
import { useSettingsDrawer, type SettingsDrawer } from './use-settings'
import { useSigningKey } from './use-signing-key'

export type SettingsPanel = {
  drawer: SettingsDrawer
  sidebarWidth: number
  write: (args: { definition: SettingDefinition; value: SettingValue }) => Promise<boolean>
}

export function useSettingsPanel(args: {
  api: SessionApi | null
  preferences: Record<string, unknown>
  email: string | null
  openUrl: (url: string) => void
  onPreferences: (preferences: Record<string, SettingValue>) => void
  onSignOut: () => void
  onProblem: (reason: string) => void
  onChooseModel: (id: string) => void
}): SettingsPanel {
  const { api, onProblem, openUrl } = args
  const settings = useAccountSettings({
    api,
    preferences: args.preferences,
    definitions: ATLAS_SETTINGS,
    onLoaded: args.onPreferences,
    onProblem,
  })
  const secrets = useSecrets({ api, onProblem })
  const github = useGithubConnect({ api, openUrl })
  const signingKey = useSigningKey({
    api,
    githubLogin: github.connection?.login ?? null,
    onProblem,
  })

  const cloud = useCloudPage({
    githubConnected: github.connection !== null,
    signingKeyRegistered: hasSigningKey(signingKey.view),
    onSignOut: args.onSignOut,
    onGithubActivate: github.onActivate,
    onSigningKeyActivate: signingKey.activateRotateOrEnable,
    onSigningKeyRemove: signingKey.activateRemove,
  })

  const appearance = useAppearance({ resolution: settings.resolution })

  const sidebarWidth = useMemo(
    () =>
      rangeValueOf({
        resolution: settings.resolution,
        id: ESettingId.SidebarWidth,
        fallback: SIDEBAR_WIDTH,
      }),
    [settings.resolution],
  )

  useEffect(() => {
    applySidebarWidth(sidebarWidth)
  }, [sidebarWidth])

  const drawer = useSettingsDrawer({
    settings,
    secrets,
    cloud,
    github,
    signingKey,
    appearance,
    email: args.email,
    onChooseModel: args.onChooseModel,
    onSignOut: args.onSignOut,
  })

  return { drawer, sidebarWidth, write: settings.set }
}
