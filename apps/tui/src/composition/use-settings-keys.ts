import {
  activateSetting,
  adjustSetting,
  ESettingKind,
  ESettingPage,
  type ResolvedSetting,
  type SettingValue,
} from '@dltech/atlas-core'
import type { SettingsWrite } from '@dltech/atlas-harness'
import type { KeyEvent } from '@opentui/core'
import { useCallback } from 'react'

import {
  currentPage,
  currentRow,
  movePage,
  moveRow,
  type SettingsModel,
  type SettingsState,
} from '../ui/settings-model'
import type { AtlasApp } from './compose'
import type { AccountPageControl } from './use-account-page'
import type { SecretPromptControl } from './use-secret-prompt'
import type { SettingsCloudLoginControl } from './use-settings-cloud-login'

export function useSettingsKeys(args: {
  app: AtlasApp
  view: SettingsModel
  state: SettingsState | null
  select: (target: SettingsState) => void
  settle: (result: SettingsWrite) => void
  secret: SecretPromptControl
  account: AccountPageControl
  login: SettingsCloudLoginControl
  signedIn: boolean
  onChooseModel: (id: string) => void
  onDismiss: () => void
}): { handleKey: (key: KeyEvent) => void } {
  const {
    app,
    view,
    state,
    select,
    settle,
    secret,
    account,
    login,
    signedIn,
    onChooseModel,
    onDismiss,
  } = args

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

  const handleActivate = useCallback(
    (target: SettingsState) => {
      select(target)

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
    [account, onChooseModel, secret, select, view, write],
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
      if (account.handleKey(key, { onAccountPage, signedIn })) return

      if (key.name === 'escape') {
        onDismiss()
        return
      }

      if (key.name === 'tab') {
        if (onAccountPage) login.stop()
        account.handleResetAction()
        select(movePage({ state, model: view, delta: key.shift ? -1 : 1 }))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        select(moveRow({ state, model: view, delta: key.name === 'up' ? -1 : 1 }))
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
      handleActivate,
      handleClearModel,
      login,
      onDismiss,
      secret,
      select,
      signedIn,
      state,
      view,
      write,
    ],
  )

  return { handleKey }
}
