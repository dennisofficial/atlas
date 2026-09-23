import { useCallback, useState } from 'react'

import type { CloudService, UrlOpener } from '@dltech/atlas-harness'

import { useAccountPage, type AccountPageControl } from './use-account-page'
import { useSettingsCloudLogin, type SettingsCloudLoginControl } from './use-settings-cloud-login'
import { useSettingsGithub, type SettingsGithubControl } from './use-settings-github'

export type SettingsCloudControl = {
  session: { email: string | null } | null
  login: SettingsCloudLoginControl
  account: AccountPageControl
  github: SettingsGithubControl
  readSession: () => void
  handleSignOut: () => void
  handleOpenSignInUrl: () => void
  handleOpenGithubUrl: () => void
}

export function useSettingsCloud(args: {
  cloud: CloudService
  openUrl: UrlOpener
  onSignedIn?: () => void
}): SettingsCloudControl {
  const { cloud, openUrl, onSignedIn } = args
  const [session, setSession] = useState<{ email: string | null } | null>(null)

  const readSession = useCallback(() => {
    setSession(cloud.session())
  }, [cloud])

  const handleSignedIn = useCallback(() => {
    readSession()
    onSignedIn?.()
  }, [readSession, onSignedIn])

  const handleSignOut = useCallback(() => {
    cloud.logout()
    readSession()
  }, [cloud, readSession])

  const login = useSettingsCloudLogin({ cloud, openUrl, onSignedIn: handleSignedIn })

  const github = useSettingsGithub({ cloud, openUrl })

  const account = useAccountPage({
    cloud,
    loginStatus: login.state.status,
    onSignOut: handleSignOut,
    onBeginSignIn: login.begin,
    onSettled: readSession,
    onGithubActivate: github.activate,
  })

  const handleOpenSignInUrl = useCallback(() => {
    const url = login.state.prompt?.url
    if (url === undefined || url.length === 0) return

    openUrl(url)
  }, [openUrl, login.state.prompt])

  const handleOpenGithubUrl = useCallback(() => {
    const url = github.flow.prompt?.url
    if (url === undefined || url.length === 0) return

    openUrl(url)
  }, [openUrl, github.flow.prompt])

  return {
    session,
    login,
    account,
    github,
    readSession,
    handleSignOut,
    handleOpenSignInUrl,
    handleOpenGithubUrl,
  }
}
