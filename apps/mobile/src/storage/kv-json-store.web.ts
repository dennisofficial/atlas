import type { JsonStore } from './json-store'

const prefixOf = (database: string): string => `${database}:`

const storageOf = (): Storage | undefined => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const quietly = <T>(run: () => T, fallback: T): T => {
  try {
    return run()
  } catch {
    return fallback
  }
}

export const kvJsonStore = ({ database }: { database: string }): JsonStore => {
  const prefix = prefixOf(database)
  const keys = (): string[] => {
    const storage = storageOf()
    if (storage === undefined) return []
    return Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '').flatMap(
      (key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []),
    )
  }
  return {
    read: async (name) =>
      quietly(() => {
        const raw = storageOf()?.getItem(prefix + name) ?? null
        return raw === null ? undefined : JSON.parse(raw)
      }, undefined),
    write: async (name, value) =>
      quietly(() => storageOf()?.setItem(prefix + name, JSON.stringify(value)), undefined),
    remove: async (name) => quietly(() => storageOf()?.removeItem(prefix + name), undefined),
    keys: async () => quietly(keys, []),
    clear: async () => {
      for (const name of quietly(keys, []))
        quietly(() => storageOf()?.removeItem(prefix + name), undefined)
    },
  }
}
