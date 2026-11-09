export type JsonStore = {
  read: (name: string) => Promise<unknown>
  write: (name: string, value: unknown) => Promise<void>
  remove: (name: string) => Promise<void>
  keys: () => Promise<readonly string[]>
  clear: () => Promise<void>
}

export const memoryJsonStore = (): JsonStore => {
  const files = new Map<string, unknown>()
  return {
    read: (name) => Promise.resolve(files.get(name)),
    write: (name, value) => {
      files.set(name, value)
      return Promise.resolve()
    },
    remove: (name) => {
      files.delete(name)
      return Promise.resolve()
    },
    keys: () => Promise.resolve([...files.keys()]),
    clear: () => {
      files.clear()
      return Promise.resolve()
    },
  }
}

export const failingJsonStore = (): JsonStore => {
  const fail = (): Promise<never> => Promise.reject(new Error('the store is unavailable'))
  return { read: fail, write: fail, remove: fail, keys: fail, clear: fail }
}
