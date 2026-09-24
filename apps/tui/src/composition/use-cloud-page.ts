import type { KeyEvent } from '@opentui/core'
import type { CloudService } from '@dltech/atlas-harness'
import { useCallback, useState } from 'react'

import { ECloudAction } from '../ui/components/settings/cloud'
import { ESettingsLogin } from '../ui/settings-login-model'

export type CloudPageControl = {
  action: ECloudAction | null
  handleResetAction: () => void
  handleDisarmAction: () => void
  handleActivate: () => void
  handleKey: (key: KeyEvent, context: CloudKeyContext) => boolean
}

export type CloudKeyContext = {
  onCloudPage: boolean
  signedIn: boolean
  rowIndex: number
  rowCount: number
}

const CLOUD_ACTIONS: readonly ECloudAction[] = [
  ECloudAction.SignOut,
  ECloudAction.Upload,
  ECloudAction.Download,
  ECloudAction.Github,
]

const LAST_ACTION = CLOUD_ACTIONS[CLOUD_ACTIONS.length - 1] ?? ECloudAction.SignOut

export function useCloudPage(args: {
  cloud: CloudService
  loginStatus: ESettingsLogin
  onSignOut: () => void
  onBeginSignIn: () => void
  onUpload: () => void
  onDownload: () => void
  onGithubActivate: () => void
}): CloudPageControl {
  const { cloud, loginStatus, onSignOut, onBeginSignIn, onUpload, onDownload, onGithubActivate } =
    args
  const [action, setAction] = useState<ECloudAction | null>(ECloudAction.SignOut)

  const handleResetAction = useCallback(() => {
    setAction(ECloudAction.SignOut)
  }, [])

  const handleDisarmAction = useCallback(() => {
    setAction(null)
  }, [])

  const handleActivate = useCallback(() => {
    if (cloud.session() !== null) {
      if (action === ECloudAction.Upload) {
        onUpload()
        return
      }
      if (action === ECloudAction.Download) {
        onDownload()
        return
      }
      if (action === ECloudAction.Github) {
        onGithubActivate()
        return
      }
      if (action === ECloudAction.SignOut) onSignOut()
      return
    }
    if (loginStatus === ESettingsLogin.Idle) onBeginSignIn()
  }, [action, cloud, loginStatus, onBeginSignIn, onDownload, onGithubActivate, onSignOut, onUpload])

  const handleKey = useCallback(
    (key: KeyEvent, context: CloudKeyContext): boolean => {
      if (!context.onCloudPage || !context.signedIn) return false
      if (key.name !== 'up' && key.name !== 'down') return false

      const delta = key.name === 'down' ? 1 : -1

      if (action !== null) {
        const next = CLOUD_ACTIONS.indexOf(action) + delta
        if (next >= CLOUD_ACTIONS.length) {
          if (context.rowCount === 0) return true
          setAction(null)
          return true
        }
        if (next >= 0) setAction(CLOUD_ACTIONS[next] ?? ECloudAction.SignOut)
        return true
      }

      if (delta < 0 && context.rowIndex === 0) {
        setAction(LAST_ACTION)
        return true
      }

      return false
    },
    [action],
  )

  return { action, handleResetAction, handleDisarmAction, handleActivate, handleKey }
}
