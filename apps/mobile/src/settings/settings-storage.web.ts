import type { JsonStore } from '../storage/json-store'
import { jsonSettingsStorage, type SettingsStorage } from './settings-store'

const PREFIX = 'atlas.settings'

const keyOf = (name: string): string => `${PREFIX}:${name}`

const localJsonStore = (): JsonStore => ({
  read: async (name) => {
    try {
      const raw = window.localStorage.getItem(keyOf(name))
      return raw === null ? undefined : JSON.parse(raw)
    } catch {
      return undefined
    }
  },
  write: async (name, value) => {
    try {
      window.localStorage.setItem(keyOf(name), JSON.stringify(value))
    } catch {
      return undefined
    }
  },
  remove: async (name) => {
    try {
      window.localStorage.removeItem(keyOf(name))
    } catch {
      return undefined
    }
  },
  keys: async () => [],
  clear: async () => {
    try {
      window.localStorage.removeItem(keyOf('settings.json'))
    } catch {
      return undefined
    }
  },
})

let storage: SettingsStorage | undefined

export const settingsStorage = (): SettingsStorage => {
  storage ??= jsonSettingsStorage({ store: localJsonStore() })
  return storage
}

export const clearSettingsCache = async (): Promise<void> => {
  await settingsStorage().clear()
}
