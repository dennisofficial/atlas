import {
  activateSetting,
  adjustSetting,
  ESettingKind,
  ESettingPage,
  type SettingValue,
} from '@dltech/atlas-core'
import type { SettingsWrite } from '@dltech/atlas-harness'
import type { KeyEvent } from '@opentui/core'
import { useCallback } from 'react'

import {
  currentPage,
  currentRow,
  isOverriddenSetting,
  movePage,
  moveRow,
  type SettingsModel,
  type SettingsRow,
  type SettingsState,
} from '../ui/settings-model'
import type { AtlasApp } from './compose'
import type { CloudPageControl } from './use-cloud-page'
import type { SecretPromptControl } from './use-secret-prompt'
import type { TextPromptControl } from './use-text-prompt'
import type { SettingsCloudLoginControl } from './use-settings-cloud-login'
import type { SettingsGithubControl } from './use-settings-github'

export function useSettingsKeys(args: {
  app: AtlasApp
  view: SettingsModel
  state: SettingsState | null
  select: (target: SettingsState) => void
  settle: (result: SettingsWrite) => void
  secret: SecretPromptControl
  text: TextPromptControl
  cloudPage: CloudPageControl
  login: SettingsCloudLoginControl
  github: SettingsGithubControl
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
    text,
    cloudPage,
    login,
    github,
    signedIn,
    onChooseModel,
    onDismiss,
  } = args

  const cloudRow = useCallback(
    (target: SettingsState): SettingsState => {
      const page = currentPage({ state: target, model: view })
      if (page?.page.id !== ESettingPage.Cloud || signedIn) return target
      return { ...target, rowIndex: target.rowIndex - 1 }
    },
    [signedIn, view],
  )

  const write = useCallback(
    (target: SettingsState, next: (row: SettingsRow) => SettingValue) => {
      const row = currentRow({ state: cloudRow(target), model: view })
      if (row === undefined || isOverriddenSetting(row)) return

      settle(app.settings.set({ id: row.definition.id, value: next(row) }))
    },
    [app.settings, cloudRow, settle, view],
  )

  const handleClearValue = useCallback(
    (target: SettingsState) => {
      const row = currentRow({ state: cloudRow(target), model: view })
      if (row === undefined || isOverriddenSetting(row)) return
      if (row.definition.kind !== ESettingKind.Model && row.definition.kind !== ESettingKind.Text) {
        return
      }
      if (typeof row.value !== 'string' || row.value.length === 0) return

      settle(app.settings.clear({ id: row.definition.id }))
    },
    [app.settings, cloudRow, settle, view],
  )

  const handleActivate = useCallback(
    (target: SettingsState) => {
      select(target)

      if (currentPage({ state: target, model: view })?.page.id === ESettingPage.Cloud) {
        if (!signedIn) {
          if (target.rowIndex === 0) {
            cloudPage.handleActivate()
            return
          }
        } else if (cloudPage.action !== null) {
          cloudPage.handleActivate()
          return
        }
      }

      const row = currentRow({ state: cloudRow(target), model: view })
      if (row === undefined || isOverriddenSetting(row)) return

      if (row.definition.kind === ESettingKind.Secret) {
        secret.open(row.definition.id)
        return
      }

      if (row.definition.kind === ESettingKind.Model) {
        onChooseModel(row.definition.id)
        return
      }

      if (row.definition.kind === ESettingKind.Text) {
        text.open(row.definition, row.value)
        return
      }

      write(target, (held) => activateSetting({ definition: held.definition, current: held.value }))
    },
    [cloudPage, cloudRow, onChooseModel, secret, select, signedIn, text, view, write],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return
      key.preventDefault()

      if (secret.prompt !== null) {
        secret.handleKey(key, secret.prompt)
        return
      }

      if (text.prompt !== null) {
        text.handleKey(key, text.prompt)
        return
      }

      const page = currentPage({ state, model: view })
      const onCloudPage = page?.page.id === ESettingPage.Cloud
      if (
        cloudPage.handleKey(key, {
          onCloudPage,
          signedIn,
          rowIndex: state.rowIndex,
          rowCount: page?.rows.length ?? 0,
        })
      ) {
        return
      }

      if (key.name === 'escape') {
        onDismiss()
        return
      }

      if (key.name === 'tab') {
        if (onCloudPage) {
          login.stop()
          github.stop()
        }
        cloudPage.handleResetAction()
        select(movePage({ state, model: view, delta: key.shift ? -1 : 1 }))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        const delta = key.name === 'up' ? -1 : 1
        if (onCloudPage && !signedIn) {
          select({ pageIndex: state.pageIndex, rowIndex: Math.max(0, state.rowIndex + delta) })
          return
        }
        select(moveRow({ state, model: view, delta }))
        return
      }

      if (key.name === 'return') {
        handleActivate(state)
        return
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        handleClearValue(state)
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
      cloudPage,
      cloudRow,
      github,
      handleActivate,
      handleClearValue,
      login,
      onDismiss,
      secret,
      select,
      signedIn,
      state,
      text,
      view,
      write,
    ],
  )

  return { handleKey }
}
