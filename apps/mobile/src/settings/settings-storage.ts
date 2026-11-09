import { fileJsonStore } from '../storage/file-json-store'
import { jsonSettingsStorage, type SettingsStorage } from './settings-store'

const SETTINGS_PATH = ['atlas'] as const

const store = (): SettingsStorage =>
  jsonSettingsStorage({ store: fileJsonStore({ path: SETTINGS_PATH }) })

let storage: SettingsStorage | undefined

export const settingsStorage = (): SettingsStorage => {
  storage ??= store()
  return storage
}

export const clearSettingsCache = async (): Promise<void> => {
  await settingsStorage().clear()
}
