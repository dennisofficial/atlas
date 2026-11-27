import type { KeyEvent } from '@opentui/core'
import { useCallback, useState } from 'react'

import type { SettingsResolution } from '@dltech/atlas-core'

import { EPanel } from './app-screen'
import { loginFlowOf } from './account/login-flow'
import { onboardingDue } from './onboarding-rows'
import type { SessionApi } from './session-api'
import { useAccounts, type AccountsControl } from './use-accounts'
import { useOnboarding, type OnboardingControl } from './use-onboarding'

export type AppOverlays = {
  accounts: AccountsControl
  onboarding: OnboardingControl
  shown: EPanel | null
  openAccounts: () => void
  openSettings: () => void
  handleKey: (key: KeyEvent) => boolean
}

export function useAppOverlays(args: {
  api: SessionApi | null
  openUrl: (url: string) => void
  onChanged: () => void
  onProblem: (reason: string) => void
  env?: Record<string, string | undefined> | undefined
  platform?: string | undefined
  resolution: SettingsResolution
  onChooseModel: (id: string) => void
  settingsOpen: boolean
  handleSettingsKey: (key: KeyEvent) => boolean
  openSettings: () => void
}): AppOverlays {
  const [shown, setShown] = useState<EPanel | null>(null)

  const accounts = useAccounts({
    api: args.api,
    openUrl: args.openUrl,
    onChanged: args.onChanged,
    onProblem: args.onProblem,
    flow: loginFlowOf({
      env: args.env ?? process.env,
      platform: args.platform ?? process.platform,
    }),
  })

  const openAccounts = useCallback(() => {
    setShown(EPanel.Accounts)
    accounts.handleOpen()
  }, [accounts])

  const openSettings = useCallback(() => {
    setShown(EPanel.Settings)
    args.openSettings()
  }, [args])

  const onboarding = useOnboarding({
    due: accounts.ready && onboardingDue({ rows: accounts.rows }),
    rows: accounts.rows,
    resolution: args.resolution,
    onOpenAccounts: openAccounts,
    onChooseModel: args.onChooseModel,
  })

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (shown === EPanel.Settings) {
        if (args.settingsOpen) return args.handleSettingsKey(key)
        setShown(null)
      } else if (args.handleSettingsKey(key)) {
        return true
      }

      if (shown === EPanel.Accounts) {
        accounts.handleKey(key)
        return true
      }
      if (onboarding.handleKey(key)) return true

      if (key.ctrl && key.name === 'o') {
        openSettings()
        return true
      }
      if (key.ctrl && key.name === 'a') {
        openAccounts()
        return true
      }

      return false
    },
    [accounts, args, onboarding, openAccounts, openSettings, shown],
  )

  return { accounts, onboarding, shown, openAccounts, openSettings, handleKey }
}
