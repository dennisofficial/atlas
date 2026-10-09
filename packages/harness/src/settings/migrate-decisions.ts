import {
  decisionsPresetOfUrl,
  decisionsProviderOf,
  decisionsTokenNameOf,
  EDecisionsProvider,
  ESettingId,
  ESettingsLayer,
  textValueOf,
  type SecretsPort,
} from '@dltech/atlas-core'

import type { SettingsService } from './service'

const FLAT_TOKEN_NAME: string = ESettingId.DecisionsToken

export function migrateDecisionsSettings(args: {
  settings: SettingsService
  secrets: SecretsPort
}): void {
  const { settings, secrets } = args
  const { resolution } = settings.snapshot()

  const providerSetting = resolution.settings.get(ESettingId.DecisionsProvider)
  const providerSet = providerSetting !== undefined && providerSetting.layer !== ESettingsLayer.Default

  if (providerSet) {
    if (typeof providerSetting.value !== 'string') return
    const chosen = decisionsProviderOf(providerSetting.value)
    if (chosen === undefined) return
    const url = textValueOf({ resolution, id: ESettingId.DecisionsUrl }).trim()
    const urlProvider = url.length > 0 ? decisionsPresetOfUrl({ url }) : undefined
    if (urlProvider !== undefined && urlProvider !== chosen) return
    const flat = secrets.read(FLAT_TOKEN_NAME)
    if (flat === undefined) return
    const target = decisionsTokenNameOf({ provider: chosen })
    if (secrets.read(target) !== undefined) return
    secrets.write({ name: target, value: flat })
    secrets.remove(FLAT_TOKEN_NAME)
    return
  }

  const url = textValueOf({ resolution, id: ESettingId.DecisionsUrl }).trim()
  if (url.length === 0) return

  const chosen = decisionsPresetOfUrl({ url }) ?? EDecisionsProvider.Custom
  const written = settings.set({ id: ESettingId.DecisionsProvider, value: chosen })
  if (!written.ok) return

  const flat = secrets.read(FLAT_TOKEN_NAME)
  if (flat === undefined) return
  const target = decisionsTokenNameOf({ provider: chosen })
  if (secrets.read(target) === undefined) secrets.write({ name: target, value: flat })
  secrets.remove(FLAT_TOKEN_NAME)
}
