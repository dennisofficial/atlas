import { SQLiteStorage } from 'expo-sqlite/kv-store'

import type { JsonStore } from './json-store'

export const kvJsonStore = ({ database }: { database: string }): JsonStore => {
  const storage = new SQLiteStorage(database)
  return {
    read: async (name) => {
      const raw = await storage.getItemAsync(name)
      if (raw === null) return undefined
      try {
        return JSON.parse(raw)
      } catch {
        return undefined
      }
    },
    write: (name, value) => storage.setItemAsync(name, JSON.stringify(value)),
    remove: async (name) => {
      await storage.removeItemAsync(name)
    },
    keys: () => storage.getAllKeysAsync(),
    clear: async () => {
      await storage.clearAsync()
    },
  }
}
