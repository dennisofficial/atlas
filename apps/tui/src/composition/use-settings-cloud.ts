import { useCallback, useState } from 'react'

import type { CloudService, UrlOpener } from '@dltech/atlas-harness'

import { useAccountPage, type AccountPageControl } from './use-account-page'
import { useSettingsCloudLogin, type SettingsCloudLoginControl } from './use-settings-cloud-login'

export type SettingsCloudControl = {
  session: { email: string | null } | null
  login: SettingsCloudLoginControl
  account: AccountPageControl
  readSession: () => void
  handleSignOut: () => void
  handleOpenSignInUrl: () => void
}

export function useSettingsCloud(args: {
  cloud: CloudService
  openUrl: UrlOpener
}): SettingsCloudControl {
  const { cloud, openUrl } = args
  const [session, setSession] = useState<{ email: string | null } | null>(null)

  const readSession = useCallback(() => {
    setSession(cloud.session())
  }, [cloud])

  const handleSignOut = useCallback(() => {
    cloud.logout()
    readSession()
  }, [cloud, readSession])

  const login = useSettingsCloudLogin({ cloud, openUrl, onSignedIn: readSession })

  const account = useAccountPage({
    cloud,
    loginStatus: login.state.status,
    onSignOut: handleSignOut,
    onBeginSignIn: login.begin,
    onSettled: readSession,
  })

  const handleOpenSignInUrl = useCallback(() => {
    const url = login.state.prompt?.url
    if (url === undefined || url.length === 0) return

    openUrl(url)
  }, [openUrl, login.state.prompt])

  return { session, login, account, readSession, handleSignOut, handleOpenSignInUrl }
}
