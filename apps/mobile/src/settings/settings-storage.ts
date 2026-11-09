import { kvJsonStore } from '../storage/kv-json-store'
import { jsonSettingsStorage, type SettingsStorage } from './settings-store'

const SETTINGS_DATABASE = 'atlas-settings'

let storage: SettingsStorage | undefined

export const settingsStorage = (): SettingsStorage => {
  storage ??= jsonSettingsStorage({ store: kvJsonStore({ database: SETTINGS_DATABASE }) })
  return storage
}

export const clearSettingsCache = async (): Promise<void> => {
  await settingsStorage().clear()
}
