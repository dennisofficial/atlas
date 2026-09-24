import { useCallback, useEffect, useRef, useState } from 'react'

import type { CloudService, CloudSyncCounts, UrlOpener } from '@dltech/atlas-harness'

import { idleSync, type CloudSyncState } from '../ui/components/settings/cloud'
import { useCloudPage, type CloudPageControl } from './use-cloud-page'
import { useSettingsCloudLogin, type SettingsCloudLoginControl } from './use-settings-cloud-login'
import { useSettingsGithub, type SettingsGithubControl } from './use-settings-github'

export type SettingsCloudControl = {
  session: { email: string | null } | null
  login: SettingsCloudLoginControl
  cloudPage: CloudPageControl
  github: SettingsGithubControl
  upload: CloudSyncState
  download: CloudSyncState
  readSession: () => void
  handleSignOut: () => void
  handleUpload: () => void
  handleDownload: () => void
  handleOpenSignInUrl: () => void
  handleOpenGithubUrl: () => void
}

const plural = (args: { count: number; noun: string }): string =>
  `${args.count} ${args.noun}${args.count === 1 ? '' : 's'}`

const syncNotice = (args: { verb: string; where: string; moved: CloudSyncCounts }): string =>
  `${args.verb} ${plural({ count: args.moved.accounts, noun: 'account' })}, ` +
  `${plural({ count: args.moved.secrets, noun: 'secret' })} and ` +
  `${plural({ count: args.moved.mcpServers, noun: 'mcp server' })} ${args.where}.`

const syncFailure = (args: { fallback: string; error: unknown }): string =>
  args.error instanceof Error ? args.error.message : args.fallback

const SYNC_FEEDBACK_MS = 6000

function useSyncFeedback(): [CloudSyncState, (next: CloudSyncState) => void] {
  const [state, setState] = useState<CloudSyncState>(idleSync)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => clear, [clear])

  const put = useCallback(
    (next: CloudSyncState) => {
      clear()
      setState(next)
      if (next.running) return
      timer.current = setTimeout(() => {
        timer.current = null
        setState(idleSync())
      }, SYNC_FEEDBACK_MS)
    },
    [clear],
  )

  return [state, put]
}

export function useSettingsCloud(args: {
  cloud: CloudService
  openUrl: UrlOpener
  onSignedIn?: () => void
}): SettingsCloudControl {
  const { cloud, openUrl, onSignedIn } = args
  const [session, setSession] = useState<{ email: string | null } | null>(null)
  const [upload, setUpload] = useSyncFeedback()
  const [download, setDownload] = useSyncFeedback()
  const uploadRunning = useRef(false)
  const downloadRunning = useRef(false)

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

  const handleUpload = useCallback(() => {
    if (uploadRunning.current) return
    uploadRunning.current = true
    setUpload({ running: true, notice: null, failure: null })
    void cloud
      .uploadLocalToCloud()
      .then((moved) =>
        setUpload({
          running: false,
          notice: syncNotice({ verb: 'Uploaded', where: 'to the cloud', moved }),
          failure: null,
        }),
      )
      .catch((error: unknown) =>
        setUpload({
          running: false,
          notice: null,
          failure: syncFailure({
            fallback: 'The upload failed — nothing was removed locally, safe to retry.',
            error,
          }),
        }),
      )
      .finally(() => {
        uploadRunning.current = false
      })
  }, [cloud])

  const handleDownload = useCallback(() => {
    if (downloadRunning.current) return
    downloadRunning.current = true
    setDownload({ running: true, notice: null, failure: null })
    void cloud
      .downloadCloudToLocal()
      .then((moved) =>
        setDownload({
          running: false,
          notice: syncNotice({ verb: 'Downloaded', where: 'to this machine', moved }),
          failure: null,
        }),
      )
      .catch((error: unknown) =>
        setDownload({
          running: false,
          notice: null,
          failure: syncFailure({
            fallback: 'The download failed — the local files were left alone, safe to retry.',
            error,
          }),
        }),
      )
      .finally(() => {
        downloadRunning.current = false
      })
  }, [cloud])

  const login = useSettingsCloudLogin({ cloud, openUrl, onSignedIn: handleSignedIn })

  const github = useSettingsGithub({ cloud, openUrl })

  const cloudPage = useCloudPage({
    cloud,
    loginStatus: login.state.status,
    onSignOut: handleSignOut,
    onBeginSignIn: login.begin,
    onUpload: handleUpload,
    onDownload: handleDownload,
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
    cloudPage,
    github,
    upload,
    download,
    readSession,
    handleSignOut,
    handleUpload,
    handleDownload,
    handleOpenSignInUrl,
    handleOpenGithubUrl,
  }
}
