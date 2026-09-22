import type { KeyEvent } from '@opentui/core'
import type { CloudService } from '@dltech/atlas-harness'
import { useCallback, useState } from 'react'

import { EAccountAction } from '../ui/components/settings/account'
import { ESettingsLogin } from '../ui/settings-login-model'
import { usePurgeConfirm, type PurgeConfirmControl } from './use-purge-confirm'

export type AccountPageControl = {
  action: EAccountAction
  purge: PurgeConfirmControl
  handleResetAction: () => void
  handleActivate: () => void
  handleKey: (key: KeyEvent, context: { onAccountPage: boolean; signedIn: boolean }) => boolean
}

export function useAccountPage(args: {
  cloud: CloudService
  loginStatus: ESettingsLogin
  onSignOut: () => void
  onBeginSignIn: () => void
  onSettled: () => void
}): AccountPageControl {
  const { cloud, loginStatus, onSignOut, onBeginSignIn, onSettled } = args
  const [action, setAction] = useState<EAccountAction>(EAccountAction.SignOut)
  const purge = usePurgeConfirm({ cloud, onSettled })

  const handleResetAction = useCallback(() => {
    setAction(EAccountAction.SignOut)
  }, [])

  const handleActivate = useCallback(() => {
    if (cloud.session() !== null) {
      if (action === EAccountAction.DownloadPurge) {
        purge.handleOpen()
        return
      }
      onSignOut()
      return
    }
    if (loginStatus === ESettingsLogin.Idle) onBeginSignIn()
  }, [action, cloud, loginStatus, onBeginSignIn, onSignOut, purge])

  const handleKey = useCallback(
    (key: KeyEvent, context: { onAccountPage: boolean; signedIn: boolean }): boolean => {
      if (purge.state !== null) {
        purge.handleKey(key)
        return true
      }

      if ((key.name === 'up' || key.name === 'down') && context.onAccountPage && context.signedIn) {
        setAction((current) =>
          current === EAccountAction.SignOut
            ? EAccountAction.DownloadPurge
            : EAccountAction.SignOut,
        )
        return true
      }

      return false
    },
    [purge],
  )

  return { action, purge, handleResetAction, handleActivate, handleKey }
}
