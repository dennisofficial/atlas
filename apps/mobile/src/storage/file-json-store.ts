import { Directory, File, Paths } from 'expo-file-system'

import { type JsonEntry, type JsonStore, serializedStore } from './json-store'

const scratchName = (name: string): string => `${name}.writing`

const fileIn = (directory: Directory, name: string): File => new File(directory, name)

export const fileJsonStore = ({ path }: { path: readonly string[] }): JsonStore => {
  const directory = new Directory(Paths.cache, ...path)
  const ensure = (): void => {
    if (!directory.exists) directory.create({ intermediates: true })
  }
  return serializedStore({
    read: async (name) => {
      const file = fileIn(directory, name)
      if (!file.exists) return undefined
      try {
        return JSON.parse(await file.text())
      } catch {
        return undefined
      }
    },
    write: async (name, value) => {
      ensure()
      const scratch = fileIn(directory, scratchName(name))
      const target = fileIn(directory, name)
      await scratch.write(JSON.stringify(value))
      if (target.exists) target.delete()
      await scratch.move(target, { overwrite: true })
    },
    remove: async (name) => {
      const file = fileIn(directory, name)
      if (file.exists) file.delete()
    },
    list: async (): Promise<readonly JsonEntry[]> => {
      if (!directory.exists) return []
      return directory.list().flatMap((entry) => {
        if (!(entry instanceof File)) return []
        const info = entry.info()
        return [{ name: entry.name, modifiedAt: info.modificationTime ?? 0 }]
      })
    },
    clear: async () => {
      if (directory.exists) directory.delete()
    },
  })
}
