import {
  activateSetting,
  adjustSetting,
  ESettingKind,
  ESettingPage,
  type SettingsResolution,
  type SettingValue,
} from '@dltech/atlas-core'
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
import type { CloudPageControl } from './use-cloud-page'
import type { SecretPromptControl } from './use-secret-prompt'
import type { TextPromptControl } from './use-text-prompt'

export function useAccountSettingsKeys(args: {
  view: SettingsModel
  state: SettingsState | null
  resolution: SettingsResolution
  select: (target: SettingsState) => void
  write: (args: {
    definition: Parameters<typeof activateSetting>[0]['definition']
    value: SettingValue
  }) => void
  clear: (args: { definition: Parameters<typeof activateSetting>[0]['definition'] }) => void
  secret: SecretPromptControl
  text: TextPromptControl
  cloudPage: CloudPageControl
  onChooseModel: (id: string) => void
  onDismiss: () => void
}): { handleKey: (key: KeyEvent) => void } {
  const { view, state, resolution, select, write, clear, secret, text, cloudPage } = args
  const { onChooseModel, onDismiss } = args

  const handleActivate = useCallback(
    (target: SettingsState) => {
      select(target)

      const page = currentPage({ state: target, model: view })
      if (page?.page.id === ESettingPage.Cloud && cloudPage.action !== null) {
        cloudPage.handleActivate()
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

      if (row.definition.kind === ESettingKind.Text) {
        text.open(row.definition, row.value)
        return
      }

      write({
        definition: row.definition,
        value: activateSetting({
          definition: row.definition,
          current: row.value,
          resolution,
        }),
      })
    },
    [cloudPage, onChooseModel, resolution, secret, select, text, view, write],
  )

  const handleClearValue = useCallback(
    (target: SettingsState) => {
      const row = currentRow({ state: target, model: view })
      if (row === undefined) return
      if (row.definition.kind !== ESettingKind.Model && row.definition.kind !== ESettingKind.Text) {
        return
      }
      if (typeof row.value !== 'string' || row.value.length === 0) return

      clear({ definition: row.definition })
    },
    [clear, view],
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
      const consumed = cloudPage.handleKey(key, {
        onCloudPage,
        signedIn: true,
        rowIndex: state.rowIndex,
        rowCount: page?.rows.length ?? 0,
      })
      if (consumed) return

      if (key.name === 'escape') {
        onDismiss()
        return
      }

      if (key.name === 'tab') {
        cloudPage.handleResetAction()
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
        handleClearValue(state)
        return
      }

      if (key.name === 'left' || key.name === 'right') {
        const row = currentRow({ state, model: view })
        if (row === undefined) return
        write({
          definition: row.definition,
          value: adjustSetting({
            definition: row.definition,
            current: row.value,
            delta: key.name === 'left' ? -1 : 1,
            resolution,
          }),
        })
      }
    },
    [
      cloudPage,
      handleActivate,
      handleClearValue,
      onDismiss,
      resolution,
      secret,
      select,
      state,
      text,
      view,
      write,
    ],
  )

  return { handleKey }
}
